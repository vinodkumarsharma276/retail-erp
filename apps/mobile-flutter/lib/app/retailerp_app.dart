import 'dart:async';
import 'package:flutter/material.dart';
import '../core/session_controller.dart';
import '../features/auth/login_page.dart';
import 'app_shell.dart';

ThemeData retailErpTheme(Brightness brightness) => ThemeData(
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xff087f8c),
    brightness: brightness,
  ),
  useMaterial3: true,
  inputDecorationTheme: const InputDecorationTheme(
    border: OutlineInputBorder(),
  ),
);

class RetailErpApp extends StatefulWidget {
  const RetailErpApp({super.key, required this.session, this.register});
  final SessionController session;
  final RegisterServices? register;
  @override
  State<RetailErpApp> createState() => _RetailErpAppState();
}

class _RetailErpAppState extends State<RetailErpApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(widget.session.initialize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(widget.session.revalidate());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'RetailERP',
    debugShowCheckedModeBanner: false,
    theme: retailErpTheme(Brightness.light),
    darkTheme: retailErpTheme(Brightness.dark),
    home: ListenableBuilder(
      listenable: widget.session,
      builder: (context, _) {
        final session = widget.session;
        // A resume re-check keeps the current screen (and any running
        // register download); only a failed check blocks it.
        final blocked =
            !session.initialized || (session.checkingAccess && !session.busy);
        if (blocked) {
          return Scaffold(
            body: SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: session.busy
                      ? const CircularProgressIndicator()
                      : Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              session.error ?? 'Session needs verification.',
                            ),
                            const SizedBox(height: 16),
                            FilledButton(
                              onPressed: session.checkingAccess
                                  ? session.revalidate
                                  : session.initialize,
                              child: const Text('Retry'),
                            ),
                            TextButton(
                              onPressed: session.signOut,
                              child: const Text('Clear session and sign in'),
                            ),
                          ],
                        ),
                ),
              ),
            ),
          );
        }
        return session.identity == null
            ? LoginPage(session: session)
            : AppShell(session: session, register: widget.register);
      },
    ),
  );
}
