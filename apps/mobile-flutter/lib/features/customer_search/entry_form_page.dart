import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import '../../core/session_controller.dart';
import '../../core/session_models.dart';
import 'customer_search_controller.dart';
import 'register_models.dart';

String newRequestId() {
  final random = Random.secure();
  final b = List<int>.generate(16, (_) => random.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final hex = b.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

String isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// New entry or edit, saved online only. Input is kept whenever a save fails.
class EntryFormPage extends StatefulWidget {
  const EntryFormPage({
    super.key,
    required this.session,
    required this.register,
    this.editing,
  });
  final SessionController session;
  final CustomerSearchController register;
  final RegisterEntry? editing;
  @override
  State<EntryFormPage> createState() => _EntryFormPageState();
}

class _EntryFormPageState extends State<EntryFormPage> {
  final _form = GlobalKey<FormState>();
  final _account = TextEditingController();
  final _name = TextEditingController();
  final _mobile = TextEditingController();
  final _address = TextEditingController();
  final _area = TextEditingController();
  final _coName = TextEditingController();
  final _coMobile = TextEditingController();
  final _product = TextEditingController();
  final _brand = TextEditingController();
  final _model = TextEditingController();
  late RegisterEntry? _base = widget.editing;
  String? _purchaseDate;
  String? _categoryId;
  late String _shopId;
  String? _series;
  bool _newSeries = false;
  final _newSeriesText = TextEditingController();
  String? _seriesError;
  List<Json> _matches = const [];
  String? _customerId;
  Timer? _matchDebounce;
  String _requestId = newRequestId();
  bool _saving = false;

  /// The last save's outcome is unknown (connection lost after sending).
  bool _uncertain = false;
  String? _error;

  bool get _editing => widget.editing != null;
  CustomerSearchController get register => widget.register;

  @override
  void initState() {
    super.initState();
    final e = widget.editing;
    _shopId = e?.shopId ?? widget.session.api.credentials!.shopId;
    if (e != null) _fill(e);
    _mobile.addListener(_queueMatches);
    _name.addListener(_queueMatches);
  }

  void _fill(RegisterEntry e) {
    _account.text = e.accountNumber;
    _name.text = e.customerName;
    _mobile.text = e.mobile ?? '';
    _address.text = e.address ?? '';
    _area.text = e.area ?? '';
    _coName.text = e.coName ?? '';
    _coMobile.text = e.coMobile ?? '';
    _product.text = e.product ?? '';
    _brand.text = e.brand ?? '';
    _model.text = e.model ?? '';
    _purchaseDate = e.purchaseDate;
    _categoryId = e.categoryId;
    _shopId = e.shopId;
  }

  @override
  void dispose() {
    _matchDebounce?.cancel();
    for (final c in [
      _account,
      _name,
      _mobile,
      _address,
      _area,
      _coName,
      _coMobile,
      _product,
      _brand,
      _model,
      _newSeriesText,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  // --- Series and next number ------------------------------------------------

  Future<void> _useSeries(String prefix) async {
    final p = prefix.trim().toUpperCase();
    if (!RegExp(r'^[A-Z]{1,3}\d?$').hasMatch(p)) {
      setState(() => _seriesError = '1–3 letters, optionally one digit (CI2)');
      return;
    }
    setState(() {
      _series = p;
      _seriesError = null;
    });
    try {
      final next = await widget.session.api.request(
        'GET',
        'customer-search/next-number?prefix=${Uri.encodeQueryComponent(p)}',
      );
      if (mounted) {
        setState(() => _account.text = next['nextAccountNumber'] as String);
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _seriesError = error.message);
    }
  }

  // --- Customers already on this mobile -------------------------------------

  void _queueMatches() {
    _matchDebounce?.cancel();
    _matchDebounce = Timer(const Duration(milliseconds: 400), _loadMatches);
  }

  Future<void> _loadMatches() async {
    final mobile = _mobile.text.trim();
    if (!isValidMobile(mobile) ||
        (_editing && normalizeMobile(mobile) == (_base?.mobile ?? ''))) {
      if (_matches.isNotEmpty && mounted) setState(() => _matches = const []);
      return;
    }
    try {
      final envelope = await widget.session.api.requestEnvelope(
        'GET',
        'customer-search/customer-matches?mobile=${normalizeMobile(mobile)}&name=${Uri.encodeQueryComponent(_name.text.trim())}',
      );
      final list = (envelope['data'] as List).map((m) => object(m)).toList();
      if (mounted) {
        setState(() {
          _matches = list;
          if (!list.any((m) => m['id'] == _customerId)) _customerId = null;
        });
      }
    } on ApiException {
      // Only a suggestion; the server still matches on name + mobile.
    }
  }

  // --- Product type ----------------------------------------------------------

  List<RegisterCategory> _children(String? parentId) => register.categories
      .where((c) => c.isActive && c.parentId == parentId)
      .toList();

  List<String?> _chain() {
    final byId = {for (final c in register.categories) c.id: c};
    final chain = <String?>[];
    var current = _categoryId == null ? null : byId[_categoryId];
    while (current != null) {
      chain.insert(0, current.id);
      current = current.parentId == null ? null : byId[current.parentId];
    }
    return chain;
  }

  bool _isLeaf(String id) {
    final category = register.categories.where((c) => c.id == id).firstOrNull;
    if (category == null) return false;
    return category.isLeaf || _children(id).isEmpty;
  }

  // --- Save ------------------------------------------------------------------

  String? _text(TextEditingController c) {
    final value = c.text.trim();
    return value.isEmpty ? null : value;
  }

  Json _createBody({bool allowDuplicate = false}) => {
    'accountNumber': _account.text.trim(),
    'customerName': _name.text.trim(),
    'mobile': _text(_mobile),
    'address': _text(_address),
    'area': _text(_area),
    'coName': _text(_coName),
    'coMobile': _text(_coMobile),
    'purchaseDate': _purchaseDate,
    'categoryId': _categoryId,
    'product': _text(_product),
    'brand': _text(_brand),
    'model': _text(_model),
    'shopId': _shopId,
    'customerId': ?_customerId,
    if (allowDuplicate) 'allowDuplicate': true,
    'clientRequestId': _requestId,
  };

  Json _patchBody(RegisterEntry base, {bool allowDuplicate = false}) {
    final body = <String, Object?>{};
    void diff(String key, String? now, String? was) {
      if ((now ?? '') != (was ?? '')) body[key] = now;
    }

    diff('accountNumber', _account.text.trim(), base.accountNumber);
    diff('customerName', _name.text.trim(), base.customerName);
    if (base.mobile != null) diff('mobile', _text(_mobile), base.mobile);
    diff('address', _text(_address), base.address);
    diff('area', _text(_area), base.area);
    diff('coName', _text(_coName), base.coName);
    if (base.coMobile != null || base.coName == null) {
      diff('coMobile', _text(_coMobile), base.coMobile);
    }
    diff('product', _text(_product), base.product);
    diff('brand', _text(_brand), base.brand);
    diff('model', _text(_model), base.model);
    if (_purchaseDate != base.purchaseDate) {
      body['purchaseDate'] = _purchaseDate;
    }
    if (_categoryId != base.categoryId && _categoryId != null) {
      body['categoryId'] = _categoryId;
    }
    if (_shopId != base.shopId) body['shopId'] = _shopId;
    if (_customerId != null) body['customerId'] = _customerId;
    if (allowDuplicate) body['allowDuplicate'] = true;
    body['expectedUpdatedAt'] = base.updatedAt;
    return body;
  }

  Future<void> _save({bool allowDuplicate = false}) async {
    if (_saving || !_form.currentState!.validate()) return;
    // A new entry needs a leaf type; an edit may keep what it had (imports
    // often have none, or a top-level one), but a changed type must be a leaf.
    final categoryId = _categoryId;
    if ((!_editing && categoryId == null) ||
        (categoryId != null &&
            categoryId != _base?.categoryId &&
            !_isLeaf(categoryId))) {
      setState(
        () => _error = 'Choose the product type down to its last level.',
      );
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final base = _base;
    final wasUncertain = _uncertain;
    try {
      if (base == null) {
        await widget.session.api.request(
          'POST',
          'customer-search',
          body: _createBody(allowDuplicate: allowDuplicate),
        );
      } else {
        final body = _patchBody(base, allowDuplicate: allowDuplicate);
        if (body.length > 1) {
          await widget.session.api.request(
            'PATCH',
            'customer-search/${base.id}',
            body: body,
          );
        }
      }
      _uncertain = false;
      await register.syncNow();
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      if (error.network) {
        _uncertain = true;
        setState(
          () => _error = base == null
              ? "Couldn't confirm the save — the connection dropped. Tap Save again: it won't create a second entry."
              : "Couldn't confirm the save — the connection dropped. Tap Save again when you're back online.",
        );
      } else if (error.code == 'duplicate_account') {
        await _duplicateDialog(error);
      } else if (error.code == 'stale' && base != null) {
        await _staleDialog(base, wasUncertain);
      } else if (error.code == 'request_reused') {
        _requestId = newRequestId();
        setState(() => _error = error.message);
      } else {
        setState(() => _error = error.message);
      }
    }
  }

  Future<void> _duplicateDialog(ApiException error) async {
    final next = error.details?['nextAccountNumber'] as String?;
    final choice = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Account number already used'),
        content: Text(error.message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          if (next != null)
            TextButton(
              onPressed: () => Navigator.pop(context, 'next'),
              child: Text('Use $next'),
            ),
          FilledButton(
            onPressed: () => Navigator.pop(context, 'anyway'),
            child: const Text('Save anyway'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    if (choice == 'next' && next != null) {
      setState(() => _account.text = next);
    } else if (choice == 'anyway') {
      await _save(allowDuplicate: true);
    }
  }

  /// Someone else saved the entry since this form loaded it. Keep this
  /// person's changes on top of the latest version and let them check it.
  Future<void> _staleDialog(RegisterEntry base, bool afterUncertainSave) async {
    final mine = _patchBody(base)..remove('expectedUpdatedAt');
    await register.syncNow();
    final latest = await register.db?.entry(base.id);
    if (!mounted) return;
    if (latest == null) {
      setState(() => _error = 'This entry was deleted by someone else.');
      return;
    }
    // Our own earlier save went through before the connection dropped.
    if (afterUncertainSave && _patchBody(latest).length == 1) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _base = latest;
      _fill(latest);
      for (final key in mine.keys) {
        final value = mine[key] as String?;
        switch (key) {
          case 'accountNumber':
            _account.text = value ?? '';
          case 'customerName':
            _name.text = value ?? '';
          case 'mobile':
            _mobile.text = value ?? '';
          case 'address':
            _address.text = value ?? '';
          case 'area':
            _area.text = value ?? '';
          case 'coName':
            _coName.text = value ?? '';
          case 'coMobile':
            _coMobile.text = value ?? '';
          case 'product':
            _product.text = value ?? '';
          case 'brand':
            _brand.text = value ?? '';
          case 'model':
            _model.text = value ?? '';
          case 'purchaseDate':
            _purchaseDate = value;
          case 'categoryId':
            _categoryId = value;
          case 'shopId':
            _shopId = value ?? _shopId;
        }
      }
      _error = null;
    });
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Changed by someone else'),
        content: const Text(
          'This entry was saved by someone else after you opened it. The form now shows their version with your changes on top. Check it and tap Save again.',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  // --- UI ----------------------------------------------------------------------

  String? _mobileRule(String? value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return null;
    return isValidMobile(text) ? null : 'A 10-digit Indian mobile number';
  }

  Future<void> _pickDate() async {
    final current = _purchaseDate == null
        ? DateTime.now()
        : DateTime.tryParse(_purchaseDate!) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(1990),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _purchaseDate = isoDate(picked));
  }

  Widget _field(
    TextEditingController c,
    String label, {
    String? Function(String?)? validator,
    TextInputType? keyboard,
    int maxLength = 200,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextFormField(
      controller: c,
      decoration: InputDecoration(labelText: label, counterText: ''),
      validator: validator,
      keyboardType: keyboard,
      maxLength: maxLength,
      textCapitalization: TextCapitalization.words,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final identity = widget.session.identity!;
    final chain = _chain();
    final levels = <Widget>[];
    String? parent;
    for (var level = 0; level <= chain.length; level++) {
      final options = _children(parent);
      if (options.isEmpty) break;
      final selected = level < chain.length ? chain[level] : null;
      levels.add(
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: DropdownButtonFormField<String>(
            key: ValueKey('type-$level-$parent'),
            initialValue: options.any((o) => o.id == selected)
                ? selected
                : null,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: level == 0
                  ? 'Product type *'
                  : 'Type (level ${level + 1})',
            ),
            items: options
                .map((o) => DropdownMenuItem(value: o.id, child: Text(o.name)))
                .toList(),
            onChanged: (id) => setState(() => _categoryId = id),
          ),
        ),
      );
      if (selected == null) break;
      parent = selected;
    }
    final shopOptions = [
      ...identity.shops.map((s) => (s.id, '${s.code} — ${s.name}')),
      if (!identity.shops.any((s) => s.id == _shopId))
        (_shopId, register.shopLabel(_shopId)),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(_editing ? 'Edit entry' : 'New entry')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (widget.session.offline)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(12),
                  child: Text('Offline: saving needs a connection.'),
                ),
              ),
            if (!_editing) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _newSeries
                        ? TextField(
                            controller: _newSeriesText,
                            textCapitalization: TextCapitalization.characters,
                            decoration: InputDecoration(
                              labelText: 'New series',
                              errorText: _seriesError,
                            ),
                            onSubmitted: _useSeries,
                          )
                        : DropdownButtonFormField<String>(
                            initialValue: _series,
                            isExpanded: true,
                            decoration: InputDecoration(
                              labelText: 'Series',
                              errorText: _seriesError,
                            ),
                            items: [
                              ...register.prefixes.map(
                                (p) => DropdownMenuItem(
                                  value: p.$1,
                                  child: Text('${p.$1}  (${p.$2})'),
                                ),
                              ),
                              const DropdownMenuItem(
                                value: '+',
                                child: Text('New series…'),
                              ),
                            ],
                            onChanged: (value) {
                              if (value == '+') {
                                setState(() => _newSeries = true);
                              } else if (value != null) {
                                unawaited(_useSeries(value));
                              }
                            },
                          ),
                  ),
                  if (_newSeries)
                    IconButton(
                      tooltip: 'Use this series',
                      onPressed: () => _useSeries(_newSeriesText.text),
                      icon: const Icon(Icons.check),
                    ),
                ],
              ),
              const SizedBox(height: 12),
            ],
            _field(
              _account,
              'Account number *',
              maxLength: 30,
              validator: (v) => (v ?? '').trim().isEmpty
                  ? 'Account number is required'
                  : null,
            ),
            _field(
              _name,
              'Customer name *',
              validator: (v) =>
                  (v ?? '').trim().isEmpty ? 'Customer name is required' : null,
            ),
            if (!_editing || _base?.mobile != null)
              _field(
                _mobile,
                'Mobile',
                keyboard: TextInputType.phone,
                maxLength: 20,
                validator: _mobileRule,
              ),
            if (_matches.isNotEmpty)
              Card(
                child: RadioGroup<String>(
                  groupValue: _customerId ?? '',
                  onChanged: (v) => setState(
                    () => _customerId = (v ?? '').isEmpty ? null : v,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.fromLTRB(16, 12, 16, 0),
                        child: Text('Customers already on this mobile'),
                      ),
                      const RadioListTile<String>(
                        value: '',
                        title: Text('Decide by name + mobile'),
                        subtitle: Text(
                          'Same name links to that customer; a new name is a new customer.',
                        ),
                      ),
                      ..._matches.map(
                        (m) => RadioListTile<String>(
                          value: m['id'] as String,
                          title: Text(
                            '${m['name']}${m['exact'] == true ? '  (same name)' : ''}',
                          ),
                          subtitle: Text(
                            '${m['customerCode']} · ${m['itemCount']} item(s)',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            _field(_address, 'Address', maxLength: 500),
            _field(_area, 'Area', maxLength: 100),
            _field(_coName, 'Co-applicant name'),
            if (!_editing || _base?.coMobile != null || _base?.coName == null)
              _field(
                _coMobile,
                'Co-applicant mobile',
                keyboard: TextInputType.phone,
                maxLength: 20,
                validator: _mobileRule,
              ),
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: InkWell(
                onTap: _pickDate,
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Purchase date *',
                  ),
                  child: Text(_purchaseDate ?? 'Choose a date'),
                ),
              ),
            ),
            ...levels,
            _field(_product, 'Product (as written)'),
            _field(_brand, 'Brand', maxLength: 100),
            _field(_model, 'Model'),
            DropdownButtonFormField<String>(
              initialValue: _shopId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Shop'),
              items: shopOptions
                  .map((s) => DropdownMenuItem(value: s.$1, child: Text(s.$2)))
                  .toList(),
              onChanged: (id) => setState(() => _shopId = id ?? _shopId),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed:
                  _saving ||
                      widget.session.offline ||
                      (!_editing && _purchaseDate == null)
                  ? null
                  : () => _save(),
              icon: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined),
              label: Text(_saving ? 'Saving…' : 'Save'),
            ),
          ],
        ),
      ),
    );
  }
}
