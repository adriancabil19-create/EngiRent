import 'package:flutter/material.dart';
import '../../../core/constants/app_constants.dart';
import '../models/item_service.dart';

class CreateItemScreen extends StatefulWidget {
  const CreateItemScreen({super.key});

  @override
  State<CreateItemScreen> createState() => _CreateItemScreenState();
}

class _CreateItemScreenState extends State<CreateItemScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _priceController = TextEditingController();
  final _depositController = TextEditingController();
  final _imagesController = TextEditingController();
  final _service = ItemService();

  String _selectedCategory = AppConstants.categories.keys.first;
  String _selectedCondition = 'GOOD';
  bool _submitting = false;

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _priceController.dispose();
    _depositController.dispose();
    _imagesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    final images = _imagesController.text
        .split(',')
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toList();
    final result = await _service.createItem(
      title: _titleController.text.trim(),
      description: _descriptionController.text.trim(),
      category: _selectedCategory,
      condition: _selectedCondition,
      pricePerDay: _priceController.text.trim(),
      securityDeposit: _depositController.text.trim(),
      images: images,
    );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (result['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Item created successfully')));
      Navigator.pop(context);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((result['error'] as String?) ?? 'Failed to create item')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('List New Item')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  controller: _titleController,
                  decoration: const InputDecoration(labelText: 'Item Title'),
                  validator: (value) => value == null || value.isEmpty ? 'Required' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _descriptionController,
                  minLines: 3,
                  maxLines: 5,
                  decoration: const InputDecoration(labelText: 'Description'),
                  validator: (value) => value == null || value.isEmpty ? 'Required' : null,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _selectedCategory,
                  decoration: const InputDecoration(labelText: 'Category'),
                  items: AppConstants.categories.entries
                      .map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value)))
                      .toList(),
                  onChanged: (value) => setState(() => _selectedCategory = value ?? _selectedCategory),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _selectedCondition,
                  decoration: const InputDecoration(labelText: 'Condition'),
                  items: const [
                    DropdownMenuItem(value: 'NEW', child: Text('New')),
                    DropdownMenuItem(value: 'LIKE_NEW', child: Text('Like New')),
                    DropdownMenuItem(value: 'GOOD', child: Text('Good')),
                    DropdownMenuItem(value: 'FAIR', child: Text('Fair')),
                    DropdownMenuItem(value: 'ACCEPTABLE', child: Text('Acceptable')),
                  ],
                  onChanged: (value) => setState(() => _selectedCondition = value ?? _selectedCondition),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _priceController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Price Per Day (PHP)'),
                  validator: (value) => value == null || value.isEmpty ? 'Required' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _depositController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Security Deposit (PHP)'),
                  validator: (value) => value == null || value.isEmpty ? 'Required' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _imagesController,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Image URLs (comma-separated)',
                    helperText: 'For prototype use uploaded image URLs.',
                  ),
                  validator: (value) => value == null || value.trim().isEmpty ? 'At least one image URL is required' : null,
                ),
                const SizedBox(height: 18),
                ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Create Listing'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
