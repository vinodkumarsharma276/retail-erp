import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Users, Plus, Save, Trash2, Copy, Search, X, Eye, EyeOff, RefreshCw, Check, ChevronRight, ChevronDown, ListChecks, Store, ShieldCheck, ShieldAlert, ShieldOff, KeyRound } from 'lucide-react';
import { rolesApi, type RoleSummary, type UserSummary } from '../../api/roles-api';
import type { PermissionGroup } from '@retailerp/shared-types';
import { dependentsOf, prerequisitesFor } from '@retailerp/shared-types';
import { useToastStore } from '../../stores/toast-store';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { usePermission, useCanCheck } from '../../hooks/usePermission';
import { useEscapeKey } from '../../hooks/useEscapeKey';

type Tab = 'roles' | 'users';

export default function RolesUsersPage() {
  const [tab, setTab] = useState<Tab>('roles');

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-display">Roles & Users</h1>
          <p className="text-sm text-muted-foreground">
            Define roles, choose what each role can see and do, and assign roles to users.
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-background p-1">
          <button
            onClick={() => setTab('roles')}
            className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition ${
              tab === 'roles' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <Shield className="h-4 w-4" /> Roles
          </button>
          <button
            onClick={() => setTab('users')}
            className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition ${
              tab === 'users' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            <Users className="h-4 w-4" /> Users
          </button>
        </div>
      </header>

      {tab === 'roles' ? <RolesPanel /> : <UsersPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles panel
// ---------------------------------------------------------------------------

function RolesPanel() {
  const can = useCanCheck();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.addToast);

  const rolesQ = useQuery({ queryKey: ['rbac', 'roles'], queryFn: rolesApi.listRoles });
  const catalogQ = useQuery({ queryKey: ['rbac', 'catalog'], queryFn: rolesApi.catalog });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftPerms, setDraftPerms] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showNewRole, setShowNewRole] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoleSummary | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showOnlyGranted, setShowOnlyGranted] = useState(false);

  // Auto-select first role
  useEffect(() => {
    if (!selectedId && rolesQ.data?.length) setSelectedId(rolesQ.data[0].id);
  }, [rolesQ.data, selectedId]);

  const selectedRole = rolesQ.data?.find((r) => r.id === selectedId) ?? null;

  // Sync draft perms when role changes
  useEffect(() => {
    if (selectedRole) setDraftPerms(new Set(selectedRole.permissions));
  }, [selectedRole?.id, selectedRole?.permissions.join(',')]);

  const dirty = useMemo(() => {
    if (!selectedRole) return false;
    if (draftPerms.size !== selectedRole.permissions.length) return true;
    for (const k of selectedRole.permissions) if (!draftPerms.has(k)) return true;
    return false;
  }, [selectedRole, draftPerms]);

  const saveMut = useMutation({
    mutationFn: (perms: string[]) => rolesApi.setPermissions(selectedId!, perms),
    onSuccess: () => {
      toast({
        type: 'success',
        message:
          'Permissions saved. Signed-in users will pick up the change within a minute or on their next page refresh.',
      });
      qc.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      // Refetch /auth/me for the current session so any guard or sidebar
      // item backed by these permissions re-renders immediately.
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Save failed' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => rolesApi.deleteRole(id),
    onSuccess: () => {
      toast({ type: 'success', message: 'Role deleted' });
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['rbac', 'roles'] });
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Delete failed' }),
  });

  const cloneMut = useMutation({
    mutationFn: (input: { id: string; code: string; name: string }) =>
      rolesApi.cloneRole(input.id, input.code, input.name),
    onSuccess: (created) => {
      toast({ type: 'success', message: 'Role cloned' });
      qc.invalidateQueries({ queryKey: ['rbac', 'roles'] }).then(() => setSelectedId(created.id));
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Clone failed' }),
  });

  // Ticking a permission also ticks what it needs (e.g. "Record payment"
  // needs "Installments list"); unticking one also unticks what depends on
  // it — so a role is never saved with permissions that can't work.
  const withPrerequisites = (set: Set<string>, key: string) => {
    if (set.has(key)) return;
    set.add(key);
    for (const p of prerequisitesFor(key)) withPrerequisites(set, p);
  };
  const withoutDependents = (set: Set<string>, key: string) => {
    if (!set.delete(key)) return;
    for (const d of dependentsOf(key)) withoutDependents(set, d);
  };

  const togglePerm = (key: string) => {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) withoutDependents(next, key);
      else withPrerequisites(next, key);
      return next;
    });
  };

  const toggleGroup = (group: PermissionGroup, on: boolean) => {
    setDraftPerms((prev) => {
      const next = new Set(prev);
      for (const p of group.permissions) {
        if (on) withPrerequisites(next, p.key);
        else withoutDependents(next, p.key);
      }
      return next;
    });
  };

  if (rolesQ.isLoading || catalogQ.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      {/* Roles list */}
      <aside className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Roles
          </h2>
          {can('roles.create') && (
          <button
            onClick={() => setShowNewRole(true)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
          )}
        </div>
        <ul className="space-y-1 rounded-md border bg-card p-1">
          {rolesQ.data?.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelectedId(r.id)}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition ${
                  r.id === selectedId
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{r.name}</span>
                  <span className={`text-xs ${r.id === selectedId ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    {r.code} · {r.userCount} user{r.userCount === 1 ? '' : 's'}
                    {r.isSystem ? ' · system' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Permission editor — read-only without permission to change roles */}
      <fieldset disabled={!can('roles.edit_permissions')} className="min-w-0 space-y-4">
        {selectedRole ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-4">
              <div>
                <h2 className="text-lg font-semibold">{selectedRole.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedRole.description ?? selectedRole.code}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {draftPerms.size} of {catalogQ.data?.flatMap((g) => g.permissions).length ?? 0}{' '}
                  permissions selected
                  {selectedRole.isSystem && ' · System role (cannot be deleted)'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter permissions…"
                    className="w-56 rounded-md border bg-field py-1.5 pl-8 pr-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowOnlyGranted((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm transition ${
                    showOnlyGranted ? 'border-primary bg-primary/10 text-primary' : 'bg-background hover:bg-accent'
                  }`}
                  title="Show only permissions granted to this role"
                >
                  <ListChecks className="h-4 w-4" /> Granted only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const all = new Set((catalogQ.data ?? []).map((g) => g.module));
                    setExpandedGroups(all);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border bg-field px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <ChevronDown className="h-4 w-4" /> Expand all
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedGroups(new Set())}
                  className="inline-flex items-center gap-1 rounded-md border bg-field px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <ChevronRight className="h-4 w-4" /> Collapse all
                </button>
                <button
                  onClick={() => {
                    const code = prompt('Code (snake_case):');
                    if (!code) return;
                    const name = prompt('Display name:', `${selectedRole.name} (Copy)`);
                    if (!name) return;
                    cloneMut.mutate({ id: selectedRole.id, code, name });
                  }}
                  className="inline-flex items-center gap-1 rounded-md border bg-field px-3 py-1.5 text-sm hover:bg-accent"
                >
                  <Copy className="h-4 w-4" /> Clone
                </button>
                {!selectedRole.isSystem && (
                  <button
                    onClick={() => setConfirmDelete(selectedRole)}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                )}
                <button
                  disabled={!dirty || saveMut.isPending}
                  onClick={() => saveMut.mutate(Array.from(draftPerms))}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saveMut.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {catalogQ.data
                ?.map((g) => ({
                  group: g,
                  perms: g.permissions
                    .filter((p) => (showOnlyGranted ? draftPerms.has(p.key) : true))
                    .filter((p) =>
                      search
                        ? p.key.toLowerCase().includes(search.toLowerCase()) ||
                          p.description.toLowerCase().includes(search.toLowerCase())
                        : true,
                    ),
                }))
                .filter((x) => x.perms.length > 0)
                .map(({ group, perms }) => {
                  const granted = perms.filter((p) => draftPerms.has(p.key)).length;
                  const allOn = granted === perms.length;
                  const partial = granted > 0 && granted < perms.length;
                  // Auto-expand when filtering, or when explicitly expanded
                  const isOpen = !!search || expandedGroups.has(group.module);
                  const togglePanel = () => {
                    setExpandedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.module)) next.delete(group.module);
                      else next.add(group.module);
                      return next;
                    });
                  };
                  return (
                    <div key={group.module} className="rounded-md border bg-card">
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={togglePanel}
                          className="flex flex-1 items-center gap-2 text-left"
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-medium">{group.label}</span>
                          <span
                            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              allOn
                                ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                                : granted === 0
                                  ? 'bg-muted text-muted-foreground'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                            }`}
                          >
                            {granted}/{perms.length}
                          </span>
                        </button>
                        <input
                          type="checkbox"
                          checked={allOn}
                          ref={(el) => {
                            if (el) el.indeterminate = partial;
                          }}
                          onChange={(e) => toggleGroup(group, e.target.checked)}
                          className="h-4 w-4"
                          title={allOn ? 'Uncheck all in this group' : 'Check all in this group'}
                        />
                      </div>
                      {isOpen && (
                        <ul className="grid grid-cols-1 gap-1 border-t p-2 sm:grid-cols-2">
                          {perms.map((p) => {
                            const checked = draftPerms.has(p.key);
                            return (
                              <li key={p.key}>
                                <label
                                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition ${
                                    checked
                                      ? 'border-primary/40 bg-primary/5'
                                      : 'border-transparent hover:bg-accent/50'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePerm(p.key)}
                                    className="mt-0.5 h-3.5 w-3.5"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium leading-snug">
                                      {p.description}
                                    </p>
                                    <code className="mt-0.5 block truncate text-[10px] font-mono text-muted-foreground">
                                      {p.key}
                                    </code>
                                  </div>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        ) : (
          <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
            Select a role on the left
          </div>
        )}
      </fieldset>

      {showNewRole && (
        <NewRoleDialog
          onClose={() => setShowNewRole(false)}
          onCreated={(r) => {
            setShowNewRole(false);
            qc.invalidateQueries({ queryKey: ['rbac', 'roles'] }).then(() => setSelectedId(r.id));
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title={`Delete role "${confirmDelete?.name}"?`}
        message="This cannot be undone. The role must not be assigned to any user."
        confirmText="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmDelete) deleteMut.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function NewRoleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: RoleSummary) => void;
}) {
  useEscapeKey(true, onClose);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const toast = useToastStore((s) => s.addToast);

  const mut = useMutation({
    mutationFn: rolesApi.createRole,
    onSuccess: (r) => {
      toast({ type: 'success', message: 'Role created' });
      onCreated(r);
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Create failed' }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Create role</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            mut.mutate({ code, name, description: description || undefined });
          }}
        >
          <div>
            <label className="text-sm font-medium">Code</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
              placeholder="e.g. shop_manager"
              className="mt-1 w-full rounded-md border bg-field px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Display name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shop Manager"
              className="mt-1 w-full rounded-md border bg-field px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border bg-field px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mut.isPending || !code || !name}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {mut.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users panel
// ---------------------------------------------------------------------------

function UsersPanel() {
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.addToast);
  const usersQ = useQuery({ queryKey: ['rbac', 'users'], queryFn: rolesApi.listUsers });
  const rolesQ = useQuery({ queryKey: ['rbac', 'roles'], queryFn: rolesApi.listRoles });
  const shopsQ = useQuery({ queryKey: ['rbac', 'shops'], queryFn: rolesApi.listShops });
  const catalogQ = useQuery({ queryKey: ['rbac', 'catalog'], queryFn: rolesApi.catalog });
  const canEditUserPerms = usePermission('users.edit_permissions');
  const can = useCanCheck();
  const [search, setSearch] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [shopTarget, setShopTarget] = useState<UserSummary | null>(null);
  const [permsTarget, setPermsTarget] = useState<UserSummary | null>(null);
  const [draftShopIds, setDraftShopIds] = useState<Set<string>>(new Set());
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetResult, setResetResult] = useState<{ username: string; password: string } | null>(null);

  const assignMut = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string | null }) =>
      rolesApi.assignUserRole(userId, roleId),
    onSuccess: () => {
      toast({ type: 'success', message: 'Role updated' });
      qc.invalidateQueries({ queryKey: ['rbac', 'users'] });
      qc.invalidateQueries({ queryKey: ['rbac', 'roles'] });
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Update failed' }),
  });

  const assignShopsMut = useMutation({
    mutationFn: ({ userId, shopIds }: { userId: string; shopIds: string[] }) =>
      rolesApi.assignUserShops(userId, shopIds),
    onSuccess: () => {
      toast({ type: 'success', message: 'Shop access updated' });
      setShopTarget(null);
      setDraftShopIds(new Set());
      qc.invalidateQueries({ queryKey: ['rbac', 'users'] });
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Shop update failed' }),
  });

  const resetMut = useMutation({
    mutationFn: ({ userId, password }: { userId: string; username: string; password: string }) =>
      rolesApi.resetUserPassword(userId, password),
    onSuccess: (data, variables) => {
      toast({ type: 'success', message: 'Password reset' });
      setResetResult({ username: variables.username, password: data.newPassword });
      setResetTarget(null);
      setNewPassword('');
      setConfirmPassword('');
      setShowNewPassword(false);
      qc.invalidateQueries({ queryKey: ['rbac', 'users'] });
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Reset failed' }),
  });

  const filtered = (usersQ.data ?? []).filter((u: UserSummary) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.fullName.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openShopDialog = (user: UserSummary) => {
    setShopTarget(user);
    setDraftShopIds(new Set(user.userShops.map((userShop) => userShop.shop.id)));
  };

  const toggleDraftShop = (shopId: string) => {
    setDraftShopIds((prev) => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ type: 'success', message: 'Copied to clipboard' });
    } catch {
      toast({ type: 'error', message: 'Copy failed' });
    }
  };

  const passwordError = (() => {
    if (!resetTarget) return '';
    if (newPassword.length < 4) return 'Password must be at least 4 characters.';
    if (newPassword !== confirmPassword) return 'Passwords do not match.';
    return '';
  })();

  const closeResetDialog = () => {
    setResetTarget(null);
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
  };

  useEscapeKey(!!resetTarget, closeResetDialog);
  useEscapeKey(!!shopTarget, () => setShopTarget(null));
  useEscapeKey(!!resetResult, () => setResetResult(null));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="w-72 rounded-md border bg-field py-1.5 pl-8 pr-2 text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {usersQ.data?.length ?? 0} user{(usersQ.data?.length ?? 0) === 1 ? '' : 's'}
        </p>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">User</th>
              <th className="px-3 py-2 text-left font-medium">Phone</th>
              <th className="px-3 py-2 text-left font-medium">Shops</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Password</th>
              <th className="px-3 py-2 text-left font-medium">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((u: UserSummary) => {
              const isRevealed = revealed.has(u.id);
              const hasKnown = !!u.knownPassword && can('users.reset_password');
              return (
                <tr key={u.id} className="hover:bg-accent/50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.fullName}</div>
                    <div className="text-xs text-muted-foreground">@{u.username}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.phone}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => openShopDialog(u)}
                      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Edit shop access"
                    >
                      <Store className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {u.userShops.length
                          ? u.userShops.map((us) => `${us.shop.code}${us.isPrimary ? '*' : ''}`).join(', ')
                          : 'No shops'}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={u.roleId ?? ''}
                        disabled={!can('users.change_role')}
                        onChange={(e) =>
                          assignMut.mutate({ userId: u.id, roleId: e.target.value || null })
                        }
                        className="rounded-md border bg-field px-2 py-1 text-sm"
                      >
                        <option value="">— Legacy ({u.role}) —</option>
                        {rolesQ.data?.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      {canEditUserPerms && (
                        <button
                          type="button"
                          onClick={() => setPermsTarget(u)}
                          title="Override permissions for this user"
                          className="rounded-md border px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {hasKnown ? (
                        <>
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {isRevealed ? u.knownPassword : '•'.repeat(u.knownPassword!.length)}
                          </code>
                          <button
                            onClick={() => toggleReveal(u.id)}
                            title={isRevealed ? 'Hide' : 'Show'}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => copy(u.knownPassword!)}
                            title="Copy"
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">Changed by user</span>
                      )}
                      <button
                        onClick={() => setResetTarget(u)}
                        title="Reset password"
                        disabled={resetMut.isPending}
                        className="ml-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Reset password</h3>
              <button onClick={closeResetDialog} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Set a new password for <span className="font-mono font-medium text-foreground">@{resetTarget.username}</span>.
              The user will be signed out from existing sessions.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium">
                  New password
                </label>
                <div className="mt-1 flex rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="min-w-0 flex-1 rounded-l-md bg-transparent px-3 py-2 text-sm outline-none"
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((value) => !value)}
                    className="rounded-r-md px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm-new-password" className="block text-sm font-medium">
                  Confirm password
                </label>
                <input
                  id="confirm-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-field px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  autoComplete="new-password"
                />
              </div>
              {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeResetDialog}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetMut.isPending || !!passwordError}
                onClick={() =>
                  resetMut.mutate({
                    userId: resetTarget.id,
                    username: resetTarget.username,
                    password: newPassword,
                  })
                }
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {resetMut.isPending ? 'Resetting...' : 'Reset password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shopTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit shop access</h3>
              <button onClick={() => setShopTarget(null)} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Choose shops for <span className="font-mono font-medium text-foreground">@{shopTarget.username}</span>.
              The first selected shop becomes their login shop.
            </p>
            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-md border p-2">
              {shopsQ.isLoading ? (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">Loading shops...</p>
              ) : shopsQ.data?.length ? (
                shopsQ.data.map((shop) => {
                  const checked = draftShopIds.has(shop.id);
                  return (
                    <label
                      key={shop.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition ${
                        checked ? 'border-primary/40 bg-primary/5' : 'border-transparent hover:bg-accent/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDraftShop(shop.id)}
                        className="h-4 w-4"
                      />
                      <Store className="h-4 w-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{shop.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{shop.code}</span>
                    </label>
                  );
                })
              ) : (
                <p className="px-2 py-4 text-center text-sm text-muted-foreground">No active shops found.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Tip: uncheck all other shops if this user should access only one shop.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShopTarget(null)}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={assignShopsMut.isPending || draftShopIds.size === 0}
                onClick={() =>
                  assignShopsMut.mutate({
                    userId: shopTarget.id,
                    shopIds: Array.from(draftShopIds),
                  })
                }
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {assignShopsMut.isPending ? 'Saving...' : 'Save shops'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Password reset</h3>
              <button onClick={() => setResetResult(null)} className="rounded p-1 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              New password for <span className="font-mono font-medium text-foreground">@{resetResult.username}</span>:
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
              <code className="flex-1 text-base font-mono font-semibold">{resetResult.password}</code>
              <button
                onClick={() => copy(resetResult.password)}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Check className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
            <p className="mt-3 text-xs text-amber-700">
              Save this now — once you close this dialog, the password is no longer visible.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setResetResult(null)}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {permsTarget && catalogQ.data && (
        <UserPermissionsDialog
          user={permsTarget}
          catalog={catalogQ.data}
          onClose={() => setPermsTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-user Permissions Dialog
// ---------------------------------------------------------------------------
// Three-state per permission:
//   - inherit: respect what the role grants
//   - grant:   force-allow regardless of role
//   - deny:    force-revoke regardless of role
// ---------------------------------------------------------------------------

type OverrideState = 'inherit' | 'grant' | 'deny';

function UserPermissionsDialog({
  user,
  catalog,
  onClose,
}: {
  user: UserSummary;
  catalog: PermissionGroup[];
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);

  const qc = useQueryClient();
  const toast = useToastStore((s) => s.addToast);
  const permsQ = useQuery({
    queryKey: ['rbac', 'user-perms', user.id],
    queryFn: () => rolesApi.getUserPermissions(user.id),
  });

  // Local draft state — keyed by permission key, value is the override.
  const [drafts, setDrafts] = useState<Map<string, OverrideState>>(new Map());
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!permsQ.data) return;
    const next = new Map<string, OverrideState>();
    permsQ.data.grants.forEach((k) => next.set(k, 'grant'));
    permsQ.data.denies.forEach((k) => next.set(k, 'deny'));
    setDrafts(next);
  }, [permsQ.data]);

  const saveMut = useMutation({
    mutationFn: (payload: { grants: string[]; denies: string[] }) =>
      rolesApi.setUserPermissions(user.id, payload.grants, payload.denies),
    onSuccess: () => {
      toast({ type: 'success', message: 'Permission overrides saved' });
      qc.invalidateQueries({ queryKey: ['rbac', 'user-perms', user.id] });
      onClose();
    },
    onError: (e: any) =>
      toast({ type: 'error', message: e?.response?.data?.error ?? 'Save failed' }),
  });

  const setOverride = (key: string, state: OverrideState) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      if (state === 'inherit') next.delete(key);
      else next.set(key, state);
      return next;
    });
  };

  const handleSave = () => {
    const grants: string[] = [];
    const denies: string[] = [];
    drafts.forEach((state, key) => {
      if (state === 'grant') grants.push(key);
      else if (state === 'deny') denies.push(key);
    });
    saveMut.mutate({ grants, denies });
  };

  const rolePermSet = useMemo(
    () => new Set(permsQ.data?.rolePermissions ?? []),
    [permsQ.data],
  );

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter((g) => moduleFilter === 'all' || g.module === moduleFilter)
      .map((g) => ({
        ...g,
        permissions: g.permissions.filter(
          (p) =>
            !q ||
            p.key.toLowerCase().includes(q) ||
            (p.description ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [catalog, moduleFilter, search]);

  const draftCount = drafts.size;
  const grantCount = Array.from(drafts.values()).filter((s) => s === 'grant').length;
  const denyCount = Array.from(drafts.values()).filter((s) => s === 'deny').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border bg-card shadow-xl">
        <header className="flex items-start justify-between border-b p-4">
          <div>
            <h3 className="text-lg font-semibold">Permission overrides — {user.fullName}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Layered on top of role <strong>{permsQ.data?.role?.name ?? user.role}</strong>.
              {' '}<span className="text-emerald-700">{grantCount} grant{grantCount === 1 ? '' : 's'}</span>,{' '}
              <span className="text-red-700">{denyCount} deny{denyCount === 1 ? '' : 's'}</span>
              {draftCount === 0 && ' — user fully inherits role.'}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search permission key or description…"
              className="w-72 rounded-md border bg-field py-1.5 pl-8 pr-2 text-sm"
            />
          </div>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="rounded-md border bg-field px-2 py-1.5 text-sm"
          >
            <option value="all">All modules</option>
            {catalog.map((g) => (
              <option key={g.module} value={g.module}>{g.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDrafts(new Map())}
            disabled={draftCount === 0}
            className="ml-auto rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Reset all to inherit
          </button>
        </div>

        {/* Permission rows */}
        <div className="flex-1 overflow-y-auto p-3">
          {permsQ.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((g) => (
                <section key={g.module} className="rounded-md border">
                  <header className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>{g.label}</span>
                    <span>{g.permissions.length}</span>
                  </header>
                  <ul className="divide-y">
                    {g.permissions.map((p) => {
                      const inheritedFromRole = rolePermSet.has(p.key);
                      const draftState = drafts.get(p.key) ?? 'inherit';
                      const effective =
                        draftState === 'grant'
                          ? true
                          : draftState === 'deny'
                            ? false
                            : inheritedFromRole;
                      return (
                        <li key={p.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.key}</code>
                              <span
                                className={`text-xs ${
                                  effective ? 'text-emerald-700' : 'text-muted-foreground'
                                }`}
                              >
                                {effective ? 'Allowed' : 'Blocked'}
                              </span>
                            </div>
                            {p.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
                            )}
                          </div>
                          <div className="inline-flex shrink-0 rounded-md border bg-background p-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => setOverride(p.key, 'inherit')}
                              title={`Inherit from role (${inheritedFromRole ? 'allowed' : 'blocked'})`}
                              className={`flex items-center gap-1 rounded px-2 py-1 ${
                                draftState === 'inherit'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              <ShieldOff className="h-3 w-3" />
                              Inherit
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverride(p.key, 'grant')}
                              title="Force-allow for this user"
                              className={`flex items-center gap-1 rounded px-2 py-1 ${
                                draftState === 'grant'
                                  ? 'bg-emerald-600 text-white'
                                  : 'text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              <ShieldCheck className="h-3 w-3" />
                              Grant
                            </button>
                            <button
                              type="button"
                              onClick={() => setOverride(p.key, 'deny')}
                              title="Force-revoke for this user"
                              className={`flex items-center gap-1 rounded px-2 py-1 ${
                                draftState === 'deny'
                                  ? 'bg-red-600 text-white'
                                  : 'text-muted-foreground hover:bg-accent'
                              }`}
                            >
                              <ShieldAlert className="h-3 w-3" />
                              Deny
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {filteredGroups.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No permissions match the current filter.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            Effective set is{' '}
            <strong>
              {permsQ.data
                ? new Set([
                    ...permsQ.data.rolePermissions.filter((k) => drafts.get(k) !== 'deny'),
                    ...Array.from(drafts.entries())
                      .filter(([, v]) => v === 'grant')
                      .map(([k]) => k),
                  ]).size
                : 0}
            </strong>{' '}
            permissions.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveMut.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMut.isPending ? 'Saving…' : 'Save overrides'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
