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
  final _areaFocus = FocusNode();
  final _nameFocus = FocusNode();
  List<String> _areas = const [];
  final _brandFocus = FocusNode();
  final _modelFocus = FocusNode();
  List<String> _brands = const [];
  List<String> _models = const [];
  String? _brandsFor;
  String _modelsFor = '|';
  Timer? _modelDebounce;
  final _coName = TextEditingController();
  final _coMobile = TextEditingController();
  final _altMobile = TextEditingController();
  final _coAltMobile = TextEditingController();
  bool _altOpen = false;
  bool _coAltOpen = false;
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
    unawaited(_loadAreas());
    _brand.addListener(_queueModels);
    unawaited(_loadBrands());
  }

  Future<void> _loadAreas() async {
    try {
      final list = await register.db?.areas() ?? const <String>[];
      if (mounted) setState(() => _areas = list);
    } on Object {
      // Suggestions only; typing still works.
    }
  }

  void _fill(RegisterEntry e) {
    _account.text = e.accountNumber;
    _name.text = e.customerName;
    _mobile.text = e.mobile ?? '';
    _address.text = e.address ?? '';
    _area.text = e.area ?? '';
    _coName.text = e.coName ?? '';
    _coMobile.text = e.coMobile ?? '';
    _altMobile.text = e.altMobile ?? '';
    _coAltMobile.text = e.coAltMobile ?? '';
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
    _areaFocus.dispose();
    _nameFocus.dispose();
    _brandFocus.dispose();
    _modelFocus.dispose();
    _modelDebounce?.cancel();
    for (final c in [
      _account,
      _name,
      _mobile,
      _address,
      _area,
      _coName,
      _coMobile,
      _altMobile,
      _coAltMobile,
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
    if (!RegExp(r'^[A-Z]{2,3}\d?$').hasMatch(p)) {
      setState(
        () => _seriesError = '2 or 3 letters, optionally one digit: BD, CK2',
      );
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
    'altMobile': _text(_altMobile),
    'coAltMobile': _text(_coAltMobile),
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
    if (base.mobile != null) {
      diff('mobile', _text(_mobile), base.mobile);
      diff('altMobile', _text(_altMobile), base.altMobile);
    }
    diff('address', _text(_address), base.address);
    diff('area', _text(_area), base.area);
    diff('coName', _text(_coName), base.coName);
    if (base.coMobile != null || base.coName == null) {
      diff('coMobile', _text(_coMobile), base.coMobile);
      diff('coAltMobile', _text(_coAltMobile), base.coAltMobile);
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
    // A new entry needs a product type; the sub-type is optional (owner
    // decision 2026-11-12). An edit may keep what it had (imports often have none).
    if (!_editing && _categoryId == null) {
      setState(() => _error = 'Choose a product type.');
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
          case 'altMobile':
            _altMobile.text = value ?? '';
          case 'coAltMobile':
            _coAltMobile.text = value ?? '';
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

  /// Matches at the start first, then anywhere; at most 30.
  static Iterable<String> _suggest(List<String> all, String text) {
    final typed = text.trim().toUpperCase();
    if (typed.isEmpty) return all.take(30);
    final starts = all.where((a) => a.toUpperCase().startsWith(typed));
    final within = all.where((a) {
      final u = a.toUpperCase();
      return !u.startsWith(typed) && u.contains(typed);
    });
    return [...starts, ...within].take(30);
  }

  /// A text field that offers [options] as you type; new text is allowed.
  Widget _suggestField(
    TextEditingController controller,
    FocusNode focus,
    String label,
    List<String> options, {
    String? helper,
    int maxLength = 200,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: RawAutocomplete<String>(
      textEditingController: controller,
      focusNode: focus,
      optionsBuilder: (value) => _suggest(options, value.text),
      fieldViewBuilder: (context, controller, focus, onSubmitted) =>
          TextFormField(
            controller: controller,
            focusNode: focus,
            decoration: InputDecoration(
              labelText: label,
              helperText: helper,
              counterText: '',
            ),
            maxLength: maxLength,
            textCapitalization: TextCapitalization.characters,
            onFieldSubmitted: (_) => onSubmitted(),
          ),
      optionsViewBuilder: (context, onSelected, options) => Align(
        alignment: Alignment.topLeft,
        child: Material(
          elevation: 4,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 240, maxWidth: 360),
            child: ListView(
              padding: EdgeInsets.zero,
              shrinkWrap: true,
              children: [
                for (final o in options)
                  ListTile(
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    title: Text(o),
                    onTap: () => onSelected(o),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );

  // --- Customer name: type-or-pick ------------------------------------------

  int _nameSearch = 0;

  /// Names already used that contain the text (2+ letters), after a short
  /// pause. Picking one fills only the name; the mobile decides the person.
  Future<Iterable<Json>> _findNames(String text) async {
    final q = text.trim();
    if (q.replaceAll(RegExp('[^A-Za-z]'), '').length < 2) return const [];
    final ticket = ++_nameSearch;
    await Future<void>.delayed(const Duration(milliseconds: 300));
    if (ticket != _nameSearch || !mounted) return const [];
    try {
      final envelope = await widget.session.api.requestEnvelope(
        'GET',
        'customer-search/customer-names?q=${Uri.encodeQueryComponent(q)}',
      );
      return (envelope['data'] as List).map((n) => object(n)).toList();
    } on Object {
      return const [];
    }
  }

  Widget _nameField() => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: RawAutocomplete<Json>(
      textEditingController: _name,
      focusNode: _nameFocus,
      displayStringForOption: (n) => '${n['name']}',
      optionsBuilder: (value) => _findNames(value.text),
      fieldViewBuilder: (context, controller, focus, onSubmitted) =>
          TextFormField(
            controller: controller,
            focusNode: focus,
            decoration: const InputDecoration(
              labelText: 'Customer name *',
              helperText: 'Pick a name already used or type a new one',
              counterText: '',
            ),
            maxLength: 200,
            textCapitalization: TextCapitalization.words,
            validator: (v) =>
                (v ?? '').trim().isEmpty ? 'Customer name is required' : null,
            onFieldSubmitted: (_) => onSubmitted(),
          ),
      optionsViewBuilder: (context, onSelected, options) => Align(
        alignment: Alignment.topLeft,
        child: Material(
          elevation: 4,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 240, maxWidth: 360),
            child: ListView(
              padding: EdgeInsets.zero,
              shrinkWrap: true,
              children: [
                for (final n in options)
                  ListTile(
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    title: Text('${n['name']}'),
                    trailing: (n['count'] as num? ?? 1) > 1
                        ? Text('${n['count']} customers')
                        : null,
                    onTap: () => onSelected(n),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );

  /// "Add another number", then a second mobile field that can be removed.
  Widget _secondMobile(
    TextEditingController c, {
    required bool open,
    required ValueChanged<bool> onOpen,
  }) {
    if (!open && c.text.isEmpty) {
      return Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: () => onOpen(true),
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Add another number'),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: c,
        decoration: InputDecoration(
          labelText: 'Second mobile',
          counterText: '',
          suffixIcon: IconButton(
            tooltip: 'Remove',
            icon: const Icon(Icons.close),
            onPressed: () {
              c.clear();
              onOpen(false);
            },
          ),
        ),
        keyboardType: TextInputType.phone,
        maxLength: 20,
        validator: _mobileRule,
      ),
    );
  }

  // --- Brand and model lists (Product type → Brand → Model) -----------------
  Future<void> _loadBrands() async {
    final type = _categoryId;
    if (type == _brandsFor) return;
    _brandsFor = type;
    _queueModels();
    if (type == null) {
      if (_brands.isNotEmpty && mounted) setState(() => _brands = const []);
      return;
    }
    try {
      final envelope = await widget.session.api.requestEnvelope(
        'GET',
        'lookup/brands?categoryId=${Uri.encodeQueryComponent(type)}',
      );
      final list = (envelope['data'] as List).map((b) => '$b').toList();
      if (mounted && _brandsFor == type) setState(() => _brands = list);
    } on Object {
      // Suggestions only; typing still works.
    }
  }

  void _queueModels() {
    _modelDebounce?.cancel();
    _modelDebounce = Timer(const Duration(milliseconds: 400), _loadModels);
  }

  Future<void> _loadModels() async {
    final type = _categoryId;
    final make = _brand.text.trim().toUpperCase();
    final key = '${type ?? ''}|$make';
    if (key == _modelsFor) return;
    _modelsFor = key;
    if (type == null || make.isEmpty) {
      if (_models.isNotEmpty && mounted) setState(() => _models = const []);
      return;
    }
    try {
      final envelope = await widget.session.api.requestEnvelope(
        'GET',
        'lookup/models?categoryId=${Uri.encodeQueryComponent(type)}'
            '&brand=${Uri.encodeQueryComponent(make)}',
      );
      final list = (envelope['data'] as List).map((m) => '$m').toList();
      if (mounted && _modelsFor == key) setState(() => _models = list);
    } on Object {
      // Suggestions only.
    }
  }

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
              labelText: level == 0 ? 'Product type *' : 'Sub-type (optional)',
            ),
            items: options
                .map((o) => DropdownMenuItem(value: o.id, child: Text(o.name)))
                .toList(),
            onChanged: (id) {
              setState(() => _categoryId = id);
              unawaited(_loadBrands());
            },
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
            _nameField(),
            if (!_editing || _base?.mobile != null)
              _field(
                _mobile,
                'Mobile',
                keyboard: TextInputType.phone,
                maxLength: 20,
                validator: _mobileRule,
              ),
            if (!_editing || _base?.mobile != null)
              _secondMobile(
                _altMobile,
                open: _altOpen,
                onOpen: (v) => setState(() => _altOpen = v),
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
            _suggestField(
              _area,
              _areaFocus,
              'Area',
              _areas,
              helper: 'Pick from the list or type a new area',
              maxLength: 100,
            ),
            _field(_coName, 'Co-applicant name'),
            if (!_editing || _base?.coMobile != null || _base?.coName == null)
              _field(
                _coMobile,
                'Co-applicant mobile',
                keyboard: TextInputType.phone,
                maxLength: 20,
                validator: _mobileRule,
              ),
            if (!_editing || _base?.coMobile != null || _base?.coName == null)
              _secondMobile(
                _coAltMobile,
                open: _coAltOpen,
                onOpen: (v) => setState(() => _coAltOpen = v),
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
            _suggestField(
              _brand,
              _brandFocus,
              'Brand',
              _brands,
              maxLength: 100,
            ),
            _suggestField(_model, _modelFocus, 'Model', _models),
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
