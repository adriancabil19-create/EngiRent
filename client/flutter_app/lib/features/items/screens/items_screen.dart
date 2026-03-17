import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/models/item_model.dart';
import '../models/item_service.dart';

class ItemsScreen extends StatefulWidget {
  const ItemsScreen({super.key});

  @override
  State<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends State<ItemsScreen> {
  final _service = ItemService();
  final _searchController = TextEditingController();
  bool _loading = true;
  String? _error;
  List<ItemModel> _items = [];

  @override
  void initState() {
    super.initState();
    _loadItems();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadItems({String? query}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await _service.getItems(query: query);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result['success']) {
        _items = result['items'] as List<ItemModel>;
      } else {
        _error = result['error'] as String?;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Browse Items'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => Navigator.pushNamed(context, '/items/create'),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search by title or description',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.arrow_forward),
                  onPressed: () => _loadItems(query: _searchController.text.trim()),
                ),
              ),
              onSubmitted: (value) => _loadItems(query: value.trim()),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _loadItems,
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? ListView(
                          children: [
                            const SizedBox(height: 100),
                            Center(child: Text(_error!)),
                          ],
                        )
                      : _items.isEmpty
                          ? ListView(
                              children: const [
                                SizedBox(height: 100),
                                Center(child: Text('No items found')),
                              ],
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                              itemCount: _items.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 10),
                              itemBuilder: (context, index) {
                                final item = _items[index];
                                final categoryLabel = AppConstants.categories[item.category] ?? item.category;
                                return Card(
                                  child: Padding(
                                    padding: const EdgeInsets.all(14),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Container(
                                              width: 54,
                                              height: 54,
                                              decoration: BoxDecoration(
                                                color: AppColors.primary.withValues(alpha: 0.12),
                                                borderRadius: BorderRadius.circular(12),
                                              ),
                                              child: const Icon(Icons.inventory_2, color: AppColors.primary),
                                            ),
                                            const SizedBox(width: 12),
                                            Expanded(
                                              child: Column(
                                                crossAxisAlignment: CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    item.title,
                                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                                                  ),
                                                  const SizedBox(height: 4),
                                                  Text(
                                                    categoryLabel,
                                                    style: const TextStyle(color: AppColors.textSecondary),
                                                  ),
                                                ],
                                              ),
                                            ),
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                              decoration: BoxDecoration(
                                                color: item.isAvailable
                                                    ? AppColors.secondary.withValues(alpha: 0.12)
                                                    : AppColors.warning.withValues(alpha: 0.12),
                                                borderRadius: BorderRadius.circular(999),
                                              ),
                                              child: Text(
                                                item.isAvailable ? 'Available' : 'In Use',
                                                style: TextStyle(
                                                  color: item.isAvailable ? AppColors.secondaryDark : AppColors.accentDark,
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 10),
                                        Text(
                                          item.description,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(color: AppColors.textSecondary),
                                        ),
                                        const SizedBox(height: 10),
                                        Row(
                                          children: [
                                            Text(
                                              'PHP ${item.pricePerDay.toStringAsFixed(0)}/day',
                                              style: const TextStyle(fontWeight: FontWeight.w700),
                                            ),
                                            const SizedBox(width: 12),
                                            Text(
                                              'Deposit: PHP ${item.securityDeposit.toStringAsFixed(0)}',
                                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
            ),
          ),
        ],
      ),
    );
  }
}
