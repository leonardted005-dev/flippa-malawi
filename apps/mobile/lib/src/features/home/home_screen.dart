import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final ApiClient _api = ApiClient();
  String _status = 'Not checked';

  Future<void> _checkApi() async {
    setState(() => _status = 'Checking…');
    try {
      final data = await _api.healthLive();
      setState(() => _status = 'API ${data['status']} · ${data['service']}');
    } catch (_) {
      setState(() => _status = 'Unreachable');
    }
  }

  @override
  void dispose() {
    _api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Digital Asset Marketplace')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Phase 1 · repository foundation',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                  SizedBox(height: 8),
                  Text('No marketplace features are implemented yet.'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              ElevatedButton(
                onPressed: _checkApi,
                child: const Text('Check API health'),
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(_status)),
            ],
          ),
        ],
      ),
    );
  }
}
