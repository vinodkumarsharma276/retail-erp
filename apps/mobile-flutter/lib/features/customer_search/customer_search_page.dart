import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/session_controller.dart';
import 'customer_search_controller.dart';
import 'entry_detail_page.dart';
import 'entry_form_page.dart';
import 'register_models.dart';

String ago(Duration age) {
  if (age.inMinutes < 1) return 'just now';
  if (age.inMinutes < 60) return '${age.inMinutes} min ago';
  if (age.inHours < 48) return '${age.inHours} h ago';
  return '${age.inDays} days ago';
}

/// Freshness of the device copy: always visible, a warning when stale.
class RegisterStatusBanner extends StatelessWidget {
  const RegisterStatusBanner({super.key, required this.register});
  final CustomerSearchController register;

  @override
  Widget build(BuildContext context) {
    final status = register.status;
    final scheme = Theme.of(context).colorScheme;
    final age = register.age;
    final offline = register.session.offline;
    String text;
    if (status == null) {
      text = 'Opening the saved register…';
    } else if (status.downloading || (!status.hasCopy && register.syncing)) {
      text = status.hasCopy
          ? 'Downloading a fresh copy (${status.downloaded} so far); showing the previous one.'
          : 'Downloading the register… ${status.downloaded} entries so far.';
    } else if (age == null) {
      text = offline
          ? 'Offline. The register has not been downloaded on this phone yet.'
          : 'The register has not been downloaded yet.';
    } else {
      text = 'Last updated ${ago(age)} · ${status.entries} entries';
      if (register.syncing) text += ' · updating…';
      if (offline) text += ' · offline';
    }
    final warn = register.stale || register.syncError != null;
    return Material(
      color: warn ? scheme.errorContainer : scheme.surfaceContainerHighest,
      child: InkWell(
        onTap: register.syncing ? null : () => unawaited(register.syncNow()),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Icon(
                warn ? Icons.warning_amber : Icons.cloud_done_outlined,
                size: 18,
                color: warn ? scheme.onErrorContainer : null,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  [
                    text,
                    if (register.stale && age != null) 'May be out of date.',
                    if (register.syncError != null)
                      'Update failed: ${register.syncError}',
                  ].join(' '),
                  style: TextStyle(
                    color: warn ? scheme.onErrorContainer : null,
                  ),
                ),
              ),
              if (register.syncing)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                const Icon(Icons.refresh, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

class CustomerSearchPage extends StatefulWidget {
  const CustomerSearchPage({
    super.key,
    required this.session,
    required this.register,
  });
  final SessionController session;
  final CustomerSearchController register;
  @override
  State<CustomerSearchPage> createState() => _CustomerSearchPageState();
}

class _CustomerSearchPageState extends State<CustomerSearchPage> {
  static const _pageSize = 50;
  final _text = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  RegisterQuery _query = const RegisterQuery();
  final List<RegisterEntry> _rows = [];
  int _total = 0;
  bool _loading = false;
  int _seenRevision = -1;
  int _generation = 0;

  CustomerSearchController get register => widget.register;

  @override
  void initState() {
    super.initState();
    register.addListener(_onRegister);
    _scroll.addListener(() {
      if (_scroll.position.extentAfter < 600) unawaited(_loadMore());
    });
    _onRegister();
  }

  @override
  void dispose() {
    register.removeListener(_onRegister);
    _debounce?.cancel();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onRegister() {
    if (register.revision != _seenRevision) {
      _seenRevision = register.revision;
      unawaited(_search());
    }
    if (mounted) setState(() {});
  }

  void _onText(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      final text = value.trim();
      // Like the web: searching all fields starts at two characters; an
      // exact search in one column takes any length.
      final min = _query.field == RegisterField.all ? 2 : 1;
      _query = _query.copyWith(text: text.length >= min ? text : '');
      register.searched();
      unawaited(_search(newQuery: true));
    });
  }

  void _setQuery(RegisterQuery next) {
    _query = next;
    unawaited(_search(newQuery: true));
  }

  /// [newQuery]: the search changed, so start again at the first row. A
  /// refresh after an update keeps the rows already loaded and the position.
  Future<void> _search({bool newQuery = false}) async {
    final db = register.db;
    if (db == null) return;
    final generation = ++_generation;
    final limit = newQuery || _rows.length < _pageSize
        ? _pageSize
        : _rows.length;
    final page = await db.search(_query, limit: limit);
    if (!mounted || generation != _generation) return;
    setState(() {
      _rows
        ..clear()
        ..addAll(page.entries);
      _total = page.total;
    });
    if (newQuery && _scroll.hasClients) _scroll.jumpTo(0);
  }

  Future<void> _loadMore() async {
    final db = register.db;
    if (db == null || _loading || _rows.length >= _total) return;
    _loading = true;
    final generation = _generation;
    final page = await db.search(
      _query,
      limit: _pageSize,
      offset: _rows.length,
    );
    _loading = false;
    if (!mounted || generation != _generation) return;
    setState(() => _rows.addAll(page.entries));
  }

  Future<void> _open(RegisterEntry entry) async {
    if (!widget.session.identity!.can('customer_search.detail')) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EntryDetailPage(
          session: widget.session,
          register: register,
          entryId: entry.id,
        ),
      ),
    );
  }

  Future<void> _create() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            EntryFormPage(session: widget.session, register: register),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final identity = widget.session.identity!;
    final canCreate = identity.can('customer_search.create');
    return Scaffold(
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              onPressed: widget.session.offline ? null : _create,
              icon: const Icon(Icons.add),
              label: Text(
                widget.session.offline
                    ? 'New entry (needs connection)'
                    : 'New entry',
              ),
            )
          : null,
      body: Column(
        children: [
          RegisterStatusBanner(register: register),
          _SearchRow(
            controller: _text,
            field: _query.field,
            onText: _onText,
            onField: (field) => _setQuery(_query.copyWith(field: field)),
          ),
          _CountsHeader(
            total: register.status?.entries ?? 0,
            found: _total,
            searching: _query.text.isNotEmpty,
            needsReview: register.needsReview,
          ),
          Expanded(
            child: _rows.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        register.status?.hasCopy == true
                            ? 'No entries match.'
                            : 'Entries appear here once the register is downloaded.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : ListView.separated(
                    controller: _scroll,
                    padding: const EdgeInsets.only(bottom: 96),
                    itemCount: _rows.length,
                    separatorBuilder: (_, _) =>
                        const Divider(height: 1, indent: 16, endIndent: 16),
                    itemBuilder: (context, i) => _EntryTile(
                      entry: _rows[i],
                      register: register,
                      onTap: () => _open(_rows[i]),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// `2025-12-28` → `28 Dec 2025` (a date only; no time zone involved).
String displayDate(String? iso) {
  final parts = (iso ?? '').split('-');
  if (parts.length != 3) return iso ?? '';
  final month = int.tryParse(parts[1]) ?? 0;
  if (month < 1 || month > 12) return iso!;
  return '${int.tryParse(parts[2]) ?? parts[2]} ${_months[month - 1]} ${parts[0]}';
}

/// `9876543210` → `98765 43210`, easier to read and dial.
String displayMobile(String mobile) => mobile.length == 10
    ? '${mobile.substring(0, 5)} ${mobile.substring(5)}'
    : mobile;

/// The column picker ("All" by default) and the search box, on one line.
class _SearchRow extends StatelessWidget {
  const _SearchRow({
    required this.controller,
    required this.field,
    required this.onText,
    required this.onField,
  });
  final TextEditingController controller;
  final RegisterField field;
  final ValueChanged<String> onText;
  final ValueChanged<RegisterField> onField;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 2),
      child: Row(
        children: [
          SizedBox(
            width: 136,
            child: DropdownButtonFormField<RegisterField>(
              initialValue: field,
              isExpanded: true,
              style: Theme.of(context).textTheme.bodyMedium,
              decoration: const InputDecoration(
                labelText: 'Search in',
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 12,
                ),
              ),
              items: RegisterField.values
                  .map(
                    (f) => DropdownMenuItem(
                      value: f,
                      child: Text(f.label, overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(),
              onChanged: (f) {
                if (f != null) onField(f);
              },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onText,
              textInputAction: TextInputAction.search,
              style: Theme.of(context).textTheme.bodyMedium,
              keyboardType: field == RegisterField.mobile
                  ? TextInputType.phone
                  : TextInputType.text,
              decoration: InputDecoration(
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                prefixIcon: const Icon(Icons.search, size: 20),
                hintText: field == RegisterField.all
                    ? 'Search'
                    : 'Exact ${field.label.toLowerCase()}',
                suffixIcon: ValueListenableBuilder(
                  valueListenable: controller,
                  builder: (context, value, _) => value.text.isEmpty
                      ? const SizedBox.shrink()
                      : IconButton(
                          tooltip: 'Clear',
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            controller.clear();
                            onText('');
                          },
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Indian digit grouping: 20976 → 20,976; 123456 → 1,23,456.
String formatCount(int n) {
  final s = n.abs().toString();
  if (s.length <= 3) return '${n < 0 ? '-' : ''}$s';
  final last3 = s.substring(s.length - 3);
  var rest = s.substring(0, s.length - 3);
  final groups = <String>[];
  while (rest.length > 2) {
    groups.insert(0, rest.substring(rest.length - 2));
    rest = rest.substring(0, rest.length - 2);
  }
  if (rest.isNotEmpty) groups.insert(0, rest);
  return '${n < 0 ? '-' : ''}${groups.join(',')},$last3';
}

/// Above the list: how many entries the register has, how many a search
/// found, and how many need review.
class _CountsHeader extends StatelessWidget {
  const _CountsHeader({
    required this.total,
    required this.found,
    required this.searching,
    required this.needsReview,
  });
  final int total;
  final int found;
  final bool searching;
  final int needsReview;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final strong = theme.textTheme.labelLarge?.copyWith(
      fontWeight: FontWeight.w700,
    );
    final muted = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 4, 14, 4),
      child: Row(
        children: [
          Expanded(
            child: Text.rich(
              searching
                  ? TextSpan(
                      children: [
                        TextSpan(text: formatCount(found), style: strong),
                        TextSpan(
                          text: ' found of ${formatCount(total)}',
                          style: muted,
                        ),
                      ],
                    )
                  : TextSpan(
                      children: [
                        TextSpan(text: formatCount(total), style: strong),
                        TextSpan(
                          text: total == 1
                              ? ' entry in the register'
                              : ' entries in the register',
                          style: muted,
                        ),
                      ],
                    ),
            ),
          ),
          if (needsReview > 0)
            Text(
              '${formatCount(needsReview)} need review',
              style: muted?.copyWith(color: theme.colorScheme.error),
            ),
        ],
      ),
    );
  }
}

/// One register entry in two lines: who and which account, then what was
/// bought, when, and the mobile. Everything else is on the details screen.
class _EntryTile extends StatelessWidget {
  const _EntryTile({
    required this.entry,
    required this.register,
    required this.onTap,
  });
  final RegisterEntry entry;
  final CustomerSearchController register;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final type = register.typePath(entry.categoryId).split(' › ').last;
    final second = [
      if (type.isNotEmpty) type else ?entry.product,
      if ((entry.purchaseDate ?? '').isNotEmpty)
        displayDate(entry.purchaseDate),
      if ((entry.mobile ?? '').isNotEmpty)
        '${displayMobile(entry.mobile!)}${(entry.altMobile ?? '').isNotEmpty ? ' +1' : ''}',
    ].where((v) => v.trim().isNotEmpty).join('  ·  ');
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 7, 12, 7),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          entry.customerName.isEmpty
                              ? '(no name)'
                              : entry.customerName,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        entry.accountNumber.isEmpty ? '—' : entry.accountNumber,
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: scheme.primary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                  if (second.isNotEmpty) ...[
                    const SizedBox(height: 1),
                    Text(
                      second,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (entry.issues.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 10),
                child: Tooltip(
                  message: entry.issues
                      .map((c) => registerIssueLabels[c] ?? c)
                      .join('\n'),
                  child: Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: scheme.error,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
