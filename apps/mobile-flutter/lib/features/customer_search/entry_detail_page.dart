import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/session_controller.dart';
import '../../core/session_models.dart';
import 'customer_search_controller.dart';
import 'entry_form_page.dart';
import 'register_models.dart';

class EntryDetailPage extends StatefulWidget {
  const EntryDetailPage({
    super.key,
    required this.session,
    required this.register,
    required this.entryId,
  });
  final SessionController session;
  final CustomerSearchController register;
  final String entryId;
  @override
  State<EntryDetailPage> createState() => _EntryDetailPageState();
}

class _EntryDetailPageState extends State<EntryDetailPage> {
  RegisterEntry? _entry;
  bool _loaded = false;
  Json? _online;
  String? _onlineError;

  @override
  void initState() {
    super.initState();
    widget.register.addListener(_load);
    unawaited(_load());
    unawaited(_loadOnline());
  }

  @override
  void dispose() {
    widget.register.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    final entry = await widget.register.db?.entry(widget.entryId);
    if (!mounted) return;
    setState(() {
      _entry = entry;
      _loaded = true;
    });
  }

  /// Who made it, where it was imported from and a linked sale need the server.
  Future<void> _loadOnline() async {
    try {
      final data = await widget.session.api.request(
        'GET',
        'customer-search/${widget.entryId}',
      );
      if (mounted) setState(() => _online = data);
    } on ApiException catch (error) {
      if (mounted) {
        setState(
          () => _onlineError = error.network
              ? 'Offline: who entered it and import details need a connection.'
              : error.message,
        );
      }
    }
  }

  Future<void> _edit() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EntryFormPage(
          session: widget.session,
          register: widget.register,
          editing: _entry,
        ),
      ),
    );
    await _load();
    await _loadOnline();
  }

  @override
  Widget build(BuildContext context) {
    final entry = _entry;
    final identity = widget.session.identity!;
    final canEdit = identity.can('customer_search.edit');
    return Scaffold(
      appBar: AppBar(
        title: Text(
          entry?.accountNumber.isNotEmpty == true
              ? entry!.accountNumber
              : 'Entry',
        ),
        actions: [
          if (canEdit && entry != null)
            IconButton(
              tooltip: widget.session.offline
                  ? 'Editing needs a connection'
                  : 'Edit',
              onPressed: widget.session.offline ? null : _edit,
              icon: const Icon(Icons.edit_outlined),
            ),
        ],
      ),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : entry == null
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('This entry is no longer in the register.'),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (entry.issues.isNotEmpty)
                  Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Needs review',
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                          ...entry.issues.map(
                            (c) => Text('• ${registerIssueLabels[c] ?? c}'),
                          ),
                          if (entry.rawValues != null &&
                              entry.rawValues!.isNotEmpty)
                            Text(
                              'The sheet said: ${entry.rawValues!.entries.map((e) => '${e.key} "${e.value}"').join(', ')}',
                            ),
                        ],
                      ),
                    ),
                  ),
                _section(context, 'Customer', [
                  ('Name', entry.customerName),
                  ('Mobile', entry.mobile),
                  ('Second mobile', entry.altMobile),
                  ('Customer code', entry.customerCode),
                  (
                    'Items bought',
                    entry.customerId == null
                        ? null
                        : '${entry.customerItemCount}',
                  ),
                  ('Address', entry.address),
                  ('Area', entry.area),
                ]),
                _section(context, 'Co-applicant', [
                  ('Name', entry.coName),
                  ('Mobile', entry.coMobile),
                  ('Second mobile', entry.coAltMobile),
                  ('Customer code', entry.coCustomerCode),
                ]),
                _section(context, 'Purchase', [
                  ('Account number', entry.accountNumber),
                  ('Purchase date', entry.purchaseDate),
                  ('Product type', widget.register.typePath(entry.categoryId)),
                  ('Product (as written)', entry.product),
                  ('Brand', entry.brand),
                  ('Model', entry.model),
                  ('Shop', widget.register.shopLabel(entry.shopId)),
                ]),
                _section(context, 'Record', [
                  (
                    'Source',
                    entry.source == 'import'
                        ? 'Imported from the sheet'
                        : 'Entered in the app',
                  ),
                  if (_online != null) ...[
                    (
                      'Entered by',
                      (_online!['creator'] as Map?)?['fullName'] as String?,
                    ),
                    ('Import', _importLabel(_online!['importBatch'])),
                    ('Matching sale', _saleLabel(_online!['matchingSale'])),
                  ],
                ]),
                if (_onlineError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _onlineError!,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
              ],
            ),
    );
  }

  static String? _importLabel(Object? batch) {
    if (batch is! Map) return null;
    return '${batch['fileName']} (records ${batch['rowFrom']}–${batch['rowTo']})';
  }

  static String? _saleLabel(Object? sale) {
    if (sale is! Map) return null;
    return '${sale['saleNumber']} · ${sale['saleDate'] ?? ''}';
  }

  Widget _section(
    BuildContext context,
    String title,
    List<(String, String?)> rows,
  ) {
    final shown = rows.where((r) => (r.$2 ?? '').isNotEmpty).toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ...shown.map(
              (r) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 130,
                      child: Text(
                        r.$1,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    Expanded(child: SelectableText(r.$2!)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
