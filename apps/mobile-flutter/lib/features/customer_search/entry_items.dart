import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import 'customer_search_controller.dart';

/// Most units in one row, and in one save (the API's limits).
const maxItemQuantity = 100;
const maxUnitsPerSave = 200;

/// Another product bought under the same account number: it becomes its own
/// entry (one per unit of [quantity]) with the same customer and date.
class ItemDraft {
  ItemDraft({
    this.categoryId,
    String brand = '',
    String model = '',
    this.quantity = 1,
  }) : brand = TextEditingController(text: brand),
       model = TextEditingController(text: model);

  String? categoryId;
  final TextEditingController brand;
  final TextEditingController model;
  int quantity;

  ItemDraft copy() => ItemDraft(
    categoryId: categoryId,
    brand: brand.text,
    model: model.text,
    quantity: quantity,
  );

  Map<String, Object?> toJson() => {
    'categoryId': categoryId,
    'brand': _blank(brand.text),
    'model': _blank(model.text),
    'quantity': quantity,
  };

  void dispose() {
    brand.dispose();
    model.dispose();
  }

  static String? _blank(String v) => v.trim().isEmpty ? null : v.trim();
}

/// A text field offering values loaded for its [listKey] (e.g. the product
/// type, or type + brand); typing narrows them, new text is allowed.
class SuggestField extends StatefulWidget {
  const SuggestField({
    super.key,
    required this.controller,
    required this.label,
    required this.listKey,
    required this.load,
    this.maxLength = 200,
  });
  final TextEditingController controller;
  final String label;

  /// The list is loaded again whenever this changes; null means no list.
  final String? listKey;
  final Future<List<String>> Function() load;
  final int maxLength;

  @override
  State<SuggestField> createState() => _SuggestFieldState();
}

class _SuggestFieldState extends State<SuggestField> {
  final _focus = FocusNode();
  List<String> _options = const [];
  String? _loadedFor;

  @override
  void didUpdateWidget(SuggestField old) {
    super.didUpdateWidget(old);
    if (old.listKey != widget.listKey) _reload();
  }

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final key = widget.listKey;
    _loadedFor = key;
    if (key == null) {
      if (_options.isNotEmpty) setState(() => _options = const []);
      return;
    }
    try {
      final list = await widget.load();
      if (mounted && _loadedFor == key) setState(() => _options = list);
    } on Object {
      // Suggestions only; typing still works.
    }
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RawAutocomplete<String>(
    textEditingController: widget.controller,
    focusNode: _focus,
    optionsBuilder: (value) {
      final typed = value.text.trim().toUpperCase();
      if (typed.isEmpty) return _options.take(30);
      return [
        ..._options.where((o) => o.toUpperCase().startsWith(typed)),
        ..._options.where((o) {
          final u = o.toUpperCase();
          return !u.startsWith(typed) && u.contains(typed);
        }),
      ].take(30);
    },
    fieldViewBuilder: (context, controller, focus, onSubmitted) =>
        TextFormField(
          controller: controller,
          focusNode: focus,
          maxLength: widget.maxLength,
          textCapitalization: TextCapitalization.characters,
          decoration: InputDecoration(
            labelText: widget.label,
            counterText: '',
            isDense: true,
          ),
          onFieldSubmitted: (_) => onSubmitted(),
        ),
    optionsViewBuilder: (context, onSelected, options) => Align(
      alignment: Alignment.topLeft,
      child: Material(
        elevation: 4,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 240, maxWidth: 320),
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
  );
}

/// Brands of a product type and models of a brand, from the server catalog.
class CatalogLookups {
  CatalogLookups(this.api);
  final ApiClient api;

  Future<List<String>> brands(String categoryId) async {
    final envelope = await api.requestEnvelope(
      'GET',
      'lookup/brands?categoryId=${Uri.encodeQueryComponent(categoryId)}',
    );
    return (envelope['data'] as List).map((b) => '$b').toList();
  }

  Future<List<String>> models(String categoryId, String brand) async {
    final envelope = await api.requestEnvelope(
      'GET',
      'lookup/models?categoryId=${Uri.encodeQueryComponent(categoryId)}'
          '&brand=${Uri.encodeQueryComponent(brand.trim().toUpperCase())}',
    );
    return (envelope['data'] as List).map((m) => '$m').toList();
  }
}

/// One more product: type (by full path), brand, model and quantity, with
/// Duplicate and Remove.
class ItemCard extends StatefulWidget {
  const ItemCard({
    super.key,
    required this.number,
    required this.item,
    required this.register,
    required this.lookups,
    required this.onChanged,
    required this.onDuplicate,
    required this.onRemove,
  });
  final int number;
  final ItemDraft item;
  final CustomerSearchController register;
  final CatalogLookups lookups;
  final VoidCallback onChanged;
  final VoidCallback onDuplicate;
  final VoidCallback onRemove;

  @override
  State<ItemCard> createState() => _ItemCardState();
}

class _ItemCardState extends State<ItemCard> {
  Timer? _brandPause;
  String _brandForModels = '';

  ItemDraft get item => widget.item;

  @override
  void initState() {
    super.initState();
    _brandForModels = item.brand.text.trim().toUpperCase();
    item.brand.addListener(_brandChanged);
  }

  void _brandChanged() {
    _brandPause?.cancel();
    _brandPause = Timer(const Duration(milliseconds: 400), () {
      final make = item.brand.text.trim().toUpperCase();
      if (mounted && make != _brandForModels) {
        setState(() => _brandForModels = make);
      }
    });
  }

  @override
  void dispose() {
    _brandPause?.cancel();
    item.brand.removeListener(_brandChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final types =
        widget.register.categories
            .where((c) => c.isActive)
            .map((c) => (c.id, widget.register.typePath(c.id)))
            .toList()
          ..sort((a, b) => a.$2.compareTo(b.$2));
    final type = item.categoryId;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 4, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  'Item ${widget.number}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'Duplicate',
                  icon: const Icon(Icons.copy_outlined, size: 20),
                  onPressed: widget.onDuplicate,
                ),
                IconButton(
                  tooltip: 'Remove',
                  icon: const Icon(Icons.delete_outline, size: 20),
                  onPressed: widget.onRemove,
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: types.any((t) => t.$1 == type) ? type : null,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Product type *',
                      isDense: true,
                    ),
                    items: [
                      for (final t in types)
                        DropdownMenuItem(
                          value: t.$1,
                          child: Text(t.$2, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    validator: (v) =>
                        v == null ? 'Choose a product type' : null,
                    onChanged: (id) {
                      setState(() => item.categoryId = id);
                      widget.onChanged();
                    },
                  ),
                  const SizedBox(height: 8),
                  SuggestField(
                    controller: item.brand,
                    label: 'Brand',
                    maxLength: 100,
                    listKey: type,
                    load: () => widget.lookups.brands(type!),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: SuggestField(
                          controller: item.model,
                          label: 'Model',
                          listKey: type == null || _brandForModels.isEmpty
                              ? null
                              : '$type|$_brandForModels',
                          load: () =>
                              widget.lookups.models(type!, _brandForModels),
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        width: 72,
                        child: TextFormField(
                          initialValue: '${item.quantity}',
                          keyboardType: TextInputType.number,
                          textAlign: TextAlign.right,
                          decoration: const InputDecoration(
                            labelText: 'Qty',
                            isDense: true,
                          ),
                          validator: (v) {
                            final n = int.tryParse((v ?? '').trim());
                            return n == null || n < 1 || n > maxItemQuantity
                                ? '1–$maxItemQuantity'
                                : null;
                          },
                          onChanged: (v) {
                            final n = int.tryParse(v.trim());
                            if (n != null && n >= 1 && n <= maxItemQuantity) {
                              item.quantity = n;
                              widget.onChanged();
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
