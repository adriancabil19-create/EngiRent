import 'package:flutter/material.dart';
import '../../../core/constants/app_colors.dart';

class KioskScanScreen extends StatefulWidget {
  const KioskScanScreen({super.key});

  @override
  State<KioskScanScreen> createState() => _KioskScanScreenState();
}

class _KioskScanScreenState extends State<KioskScanScreen> {
  final _tokenController = TextEditingController();

  @override
  void dispose() {
    _tokenController.dispose();
    super.dispose();
  }

  void _submitToken() {
    if (_tokenController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter or scan a QR token first')));
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Token captured. Proceed at kiosk terminal for face verification.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Kiosk Access')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('QR + Face Workflow', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                  SizedBox(height: 6),
                  Text(
                    'Use this screen to validate kiosk session tokens. The kiosk terminal will continue with face verification and locker actions.',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: Center(
                child: Container(
                  width: 230,
                  height: 230,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: AppColors.borderDark, width: 2),
                    color: AppColors.surface,
                  ),
                  child: const Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.qr_code_scanner, size: 68, color: AppColors.primary),
                      SizedBox(height: 8),
                      Text('Scanner Preview', style: TextStyle(fontWeight: FontWeight.w700)),
                      SizedBox(height: 4),
                      Text('Connect camera module for live scan', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _tokenController,
              decoration: const InputDecoration(
                labelText: 'Rental QR Token',
                hintText: 'Paste token if scanner is unavailable',
              ),
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _submitToken,
              icon: const Icon(Icons.verified_user),
              label: const Text('Validate Session Token'),
            ),
          ],
        ),
      ),
    );
  }
}
