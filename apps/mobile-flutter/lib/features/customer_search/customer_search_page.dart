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
      // Like the web: searching starts at two characters.
      _query = _query.copyWith(text: text.length >= 2 ? text : '');
      register.searched();
      unawaited(_search());
    });
  }

  void _setQuery(RegisterQuery next) {
    _query = next;
    unawaited(_search());
  }

  Future<void> _search() async {
    final db = register.db;
    if (db == null) return;
    final generation = ++_generation;
    final page = await db.search(_query, limit: _pageSize);
    if (!mounted || generation != _generation) return;
    setState(() {
      _rows
        ..clear()
        ..addAll(page.entries);
      _total = page.total;
    });
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
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '$_total ${_total == 1 ? 'entry' : 'entries'}',
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
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
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
      child: Row(
        children: [
          SizedBox(
            width: 136,
            child: DropdownButtonFormField<RegisterField>(
              initialValue: field,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Search in',
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 14,
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
              keyboardType: field == RegisterField.mobile
                  ? TextInputType.phone
                  : TextInputType.text,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: field == RegisterField.all
                    ? 'Search'
                    : 'Search ${field.label.toLowerCase()}',
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

/// One register entry: who, which account, what was bought, and the key
/// facts (date, mobile, area, shop) as labelled icons.
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
    final muted = theme.textTheme.bodyMedium?.copyWith(
      color: scheme.onSurfaceVariant,
    );
    final type = register.typePath(entry.categoryId);
    final product = [
      if (type.isNotEmpty) type else ?entry.product,
      ?entry.brand,
      ?entry.model,
    ].where((v) => v.trim().isNotEmpty).join(' · ');
    final shop = register.shopLabel(entry.shopId);
    final facts = <Widget>[
      if ((entry.purchaseDate ?? '').isNotEmpty)
        _Fact(Icons.event_outlined, displayDate(entry.purchaseDate)),
      if ((entry.mobile ?? '').isNotEmpty)
        _Fact(Icons.phone_outlined, displayMobile(entry.mobile!)),
      if ((entry.area ?? '').isNotEmpty)
        _Fact(Icons.place_outlined, entry.area!),
    ];
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    entry.customerName.isEmpty
                        ? '(no name)'
                        : entry.customerName,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                if (shop.isNotEmpty) ...[
                  Tooltip(
                    message: 'Shop',
                    child: _Badge(
                      shop,
                      background: scheme.surfaceContainerHighest,
                      foreground: scheme.onSurfaceVariant,
                      icon: Icons.storefront_outlined,
                    ),
                  ),
                  const SizedBox(width: 6),
                ],
                _Badge(
                  entry.accountNumber.isEmpty
                      ? 'No account no.'
                      : entry.accountNumber,
                  background: scheme.secondaryContainer,
                  foreground: scheme.onSecondaryContainer,
                ),
              ],
            ),
            if (product.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(
                product,
                style: muted,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (facts.isNotEmpty) ...[
              const SizedBox(height: 6),
              Wrap(spacing: 14, runSpacing: 4, children: facts),
            ],
            if ((entry.coName ?? '').isNotEmpty) ...[
              const SizedBox(height: 4),
              _Fact(Icons.people_outline, 'Co-applicant: ${entry.coName}'),
            ],
            if (entry.issues.isNotEmpty) ...[
              const SizedBox(height: 6),
              Tooltip(
                message: entry.issues
                    .map((c) => registerIssueLabels[c] ?? c)
                    .join('\n'),
                child: _Badge(
                  entry.issues.length == 1
                      ? 'Needs review: ${registerIssueLabels[entry.issues.first] ?? entry.issues.first}'
                      : 'Needs review: ${entry.issues.length} problems',
                  background: scheme.errorContainer,
                  foreground: scheme.onErrorContainer,
                  icon: Icons.report_problem_outlined,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            text,
            style: Theme.of(
              context,
            ).textTheme.bodySmall?.copyWith(color: color),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(
    this.text, {
    required this.background,
    required this.foreground,
    this.icon,
  });
  final String text;
  final Color background;
  final Color foreground;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 14, color: foreground),
          const SizedBox(width: 4),
        ],
        Flexible(
          child: Text(
            text,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: foreground,
              fontWeight: FontWeight.w600,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    ),
  );
}
