import 'package:flutter/material.dart';
import '../../core/session_controller.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.session});
  final SessionController session;
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _form = GlobalKey<FormState>();
  final _tenant = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _hidePassword = true;

  @override
  void dispose() {
    _tenant.dispose();
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (!widget.session.busy && _form.currentState!.validate()) {
      widget.session.signIn(_tenant.text, _username.text, _password.text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: AutofillGroup(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Icon(Icons.storefront_outlined, size: 56),
                      const SizedBox(height: 16),
                      Text(
                        'RetailERP',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineLarge,
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Sign in to your business',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 32),
                      TextFormField(
                        controller: _tenant,
                        enabled: !session.busy,
                        decoration: const InputDecoration(
                          labelText: 'Tenant slug',
                          hintText: 'Your business tenant',
                        ),
                        autocorrect: false,
                        textInputAction: TextInputAction.next,
                        validator: (value) =>
                            value == null || value.trim().isEmpty
                            ? 'Enter your tenant slug'
                            : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _username,
                        enabled: !session.busy,
                        decoration: const InputDecoration(
                          labelText: 'Username',
                        ),
                        autofillHints: const [AutofillHints.username],
                        autocorrect: false,
                        textInputAction: TextInputAction.next,
                        validator: (value) =>
                            value == null || value.trim().isEmpty
                            ? 'Enter your username'
                            : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _password,
                        enabled: !session.busy,
                        obscureText: _hidePassword,
                        autofillHints: const [AutofillHints.password],
                        decoration: InputDecoration(
                          labelText: 'Password',
                          suffixIcon: IconButton(
                            tooltip: _hidePassword
                                ? 'Show password'
                                : 'Hide password',
                            onPressed: () =>
                                setState(() => _hidePassword = !_hidePassword),
                            icon: Icon(
                              _hidePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                          ),
                        ),
                        onFieldSubmitted: (_) => _submit(),
                        validator: (value) => value == null || value.isEmpty
                            ? 'Enter your password'
                            : null,
                      ),
                      if (session.error != null) ...[
                        const SizedBox(height: 16),
                        Text(
                          session.error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: session.busy ? null : _submit,
                        child: Text(session.busy ? 'Signing in...' : 'Sign in'),
                      ),
                      const SizedBox(height: 24),
                      Text(
                        'Server: ${session.api.config.baseUrl.origin}',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
