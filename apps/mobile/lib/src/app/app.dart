import 'package:flutter/material.dart';

import '../features/home/home_screen.dart';

class FaApp extends StatelessWidget {
  const FaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Digital Asset Marketplace',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF0B5CFF),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}
