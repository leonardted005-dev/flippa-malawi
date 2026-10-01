import 'package:flutter_test/flutter_test.dart';

import 'package:fa_mobile/src/app/app.dart';

void main() {
  testWidgets('app renders the foundation home screen', (WidgetTester tester) async {
    await tester.pumpWidget(const FaApp());

    expect(find.text('Digital Asset Marketplace'), findsOneWidget);
    expect(find.text('Phase 1 · repository foundation'), findsOneWidget);
    expect(find.text('Check API health'), findsOneWidget);
  });
}
