import 'dart:async';
import 'package:flutter/material.dart';
import '../core/session_controller.dart';
import '../features/customer_search/customer_search_controller.dart';
import '../features/customer_search/customer_search_page.dart';
import '../features/customer_search/sync_settings.dart';
import '../features/feature_catalog.dart';

/// What Customer Searching needs from the platform (encrypted files, the
/// per-phone setting, background scheduling); tests pass fakes.
class RegisterServices {
  const RegisterServices({
    required this.opener,
    required this.remover,
    required this.settings,
    this.scheduleBackground,
  });
  final RegisterOpener opener;
  final RegisterRemover remover;
  final SyncSettings settings;
  final BackgroundScheduler? scheduleBackground;
}

class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.session, this.register});
  final SessionController session;
  final RegisterServices? register;
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _tab = 0;
  FeatureEntry? _selected;
  CustomerSearchController? _register;
  String? _registerOwner;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_syncRegister);
    _syncRegister();
  }

  @override
  void dispose() {
    widget.session.removeListener(_syncRegister);
    _register?.dispose();
    super.dispose();
  }

  /// Keep the signed-in user's register controller (and its timers) alive
  /// while the shell is shown; drop a copy the server says is no longer allowed.
  void _syncRegister() {
    final services = widget.register;
    final identity = widget.session.identity;
    if (services == null || identity == null) return;
    final owner = '${identity.tenantId}/${identity.userId}';
    if (_registerOwner == owner) return;
    if (canUseRegister(identity)) {
      _register?.dispose();
      _registerOwner = owner;
      _register = CustomerSearchController(
        session: widget.session,
        opener: services.opener,
        remover: services.remover,
        settings: services.settings,
        scheduleBackground: services.scheduleBackground,
      );
      unawaited(_register!.start());
    } else if (!widget.session.offline) {
      _registerOwner = owner;
      unawaited(services.remover(identity.tenantId, identity.userId));
      unawaited(services.scheduleBackground?.call(0));
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final identity = session.identity!;
    final mobileEnabled = identity.flags['mobile_app'] == true;
    final features = mobileModulesFor(identity);
    final selected = _selected;
    final permitted = selected != null && features.contains(selected);
    return PopScope(
      canPop: !permitted,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) setState(() => _selected = null);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(permitted ? selected.title : 'RetailERP'),
          leading: permitted
              ? BackButton(onPressed: () => setState(() => _selected = null))
              : null,
          actions: [
            IconButton(
              tooltip: 'Refresh access',
              onPressed: session.busy ? null : session.revalidate,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              if (session.offline)
                Material(
                  color: Theme.of(context).colorScheme.tertiaryContainer,
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: Row(
                      children: [
                        Icon(Icons.cloud_off, size: 18),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Offline — showing saved data. Saving needs a connection.',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (session.error != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    session.error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              Expanded(
                child: _tab == 1
                    ? ListView(
                        padding: const EdgeInsets.all(24),
                        children: [
                          Text(
                            identity.fullName,
                            style: Theme.of(context).textTheme.headlineSmall,
                          ),
                          Text(identity.tenantName),
                          const SizedBox(height: 24),
                          DropdownButtonFormField<String>(
                            key: ValueKey(session.api.credentials!.shopId),
                            initialValue: session.api.credentials!.shopId,
                            decoration: const InputDecoration(
                              labelText: 'Current shop',
                            ),
                            items: identity.shops
                                .map(
                                  (shop) => DropdownMenuItem(
                                    value: shop.id,
                                    child: Text('${shop.code} - ${shop.name}'),
                                  ),
                                )
                                .toList(),
                            onChanged:
                                !session.busy && identity.can('shop.switch')
                                ? (id) {
                                    if (id != null) session.switchShop(id);
                                  }
                                : null,
                          ),
                          const SizedBox(height: 24),
                          if (_register != null) ...[
                            ListenableBuilder(
                              listenable: _register!,
                              builder: (context, _) =>
                                  _RegisterSettings(register: _register!),
                            ),
                            const SizedBox(height: 24),
                          ],
                          const Text(
                            'Feature screens are being delivered incrementally.',
                          ),
                          const SizedBox(height: 24),
                          OutlinedButton.icon(
                            onPressed: session.busy ? null : session.signOut,
                            icon: const Icon(Icons.logout),
                            label: const Text('Sign out'),
                          ),
                        ],
                      )
                    : permitted &&
                          selected.id == 'customer-searching' &&
                          _register != null
                    ? CustomerSearchPage(session: session, register: _register!)
                    : permitted
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(selected.icon, size: 48),
                              const SizedBox(height: 16),
                              Text(
                                selected.title,
                                style: Theme.of(
                                  context,
                                ).textTheme.headlineSmall,
                              ),
                              const SizedBox(height: 12),
                              const Text(
                                'Coming soon to the mobile app. Use the web app for now.',
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),
                      )
                    : features.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            mobileEnabled
                                ? 'No modules are available for your permissions. Contact your administrator.'
                                : 'Mobile access is not enabled for this business. Contact your administrator.',
                          ),
                        ),
                      )
                    : ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          Padding(
                            padding: const EdgeInsets.all(8),
                            child: Text(
                              identity.tenantName,
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                          ),
                          ...features.map(
                            (feature) => Card(
                              child: ListTile(
                                leading: Icon(feature.icon),
                                title: Text(feature.title),
                                subtitle: Text(
                                  feature.id == 'customer-searching' &&
                                          _register != null
                                      ? 'Search the account register, also offline'
                                      : mobileModulesBuilt.contains(feature.id)
                                      ? 'Open'
                                      : 'Coming soon',
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () =>
                                    setState(() => _selected = feature),
                              ),
                            ),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (index) => setState(() {
            _tab = index;
            _selected = null;
          }),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.apps), label: 'Modules'),
            NavigationDestination(
              icon: Icon(Icons.person_outline),
              label: 'Account',
            ),
          ],
        ),
      ),
    );
  }
}

/// Account → how often this phone updates the register, and its state.
class _RegisterSettings extends StatelessWidget {
  const _RegisterSettings({required this.register});
  final CustomerSearchController register;

  @override
  Widget build(BuildContext context) {
    final status = register.status;
    final age = register.age;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Customer Searching on this phone',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              status == null
                  ? 'Not downloaded.'
                  : '${status.entries} entries saved · '
                        '${age == null ? 'never updated' : 'last updated ${ago(age)}'}',
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              initialValue: register.intervalMinutes,
              decoration: const InputDecoration(labelText: 'Check for updates'),
              items: SyncSettings.choices
                  .map(
                    (m) => DropdownMenuItem(
                      value: m,
                      child: Text(SyncSettings.label(m)),
                    ),
                  )
                  .toList(),
              onChanged: (m) {
                if (m != null) unawaited(register.setInterval(m));
              },
            ),
            const SizedBox(height: 4),
            Text(
              'Background updates are best effort: Android decides the exact time.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: register.syncing
                  ? null
                  : () => unawaited(register.syncNow()),
              icon: const Icon(Icons.sync),
              label: Text(register.syncing ? 'Updating…' : 'Update now'),
            ),
          ],
        ),
      ),
    );
  }
}
