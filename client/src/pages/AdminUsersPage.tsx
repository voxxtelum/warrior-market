import { useEffect, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { useAuth } from "../authContext";
import {
  getAdminUsers,
  getAdminWarriors,
  linkUserWarrior,
  setUserAdmin,
  unlinkUserWarrior,
  type AdminUserRow,
  type AdminWarriorRow,
} from "../api";

function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hours24 = d.getHours();
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const hours = hours24 % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd}-${yy}, ${hours}:${minutes} ${ampm}`;
}

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [warriors, setWarriors] = useState<AdminWarriorRow[] | null>(null);
  const [linkSelection, setLinkSelection] = useState<Record<string, number>>({});

  useEffect(() => {
    // A non-admin briefly hits this before RequireAdmin's redirect commits
    // (same client-side-only-guard tradeoff as the other admin pages) - swallow
    // the 401/403 rather than crashing on it, since the redirect is already coming.
    getAdminUsers()
      .then(setUsers)
      .catch(() => {});
    getAdminWarriors()
      .then(setWarriors)
      .catch(() => {});
  }, []);

  function toggleAdmin(user: AdminUserRow) {
    const nowAdmin = !user.isAdmin;
    setUsers((prev) => prev?.map((u) => (u.discordId === user.discordId ? { ...u, isAdmin: nowAdmin } : u)) ?? null);
    setUserAdmin(user.discordId, nowAdmin);
  }

  async function handleLink(user: AdminUserRow) {
    const warriorId = linkSelection[user.discordId];
    if (warriorId === undefined) return;
    const warrior = warriors?.find((w) => w.id === warriorId);
    if (!warrior) return;
    await linkUserWarrior(user.discordId, warriorId);
    setUsers(
      (prev) =>
        prev?.map((u) =>
          u.discordId === user.discordId
            ? { ...u, linkedWarrior: { id: warrior.id, playerName: warrior.playerName, server: warrior.server } }
            : u
        ) ?? null
    );
  }

  async function handleUnlink(user: AdminUserRow) {
    await unlinkUserWarrior(user.discordId);
    setUsers((prev) => prev?.map((u) => (u.discordId === user.discordId ? { ...u, linkedWarrior: null } : u)) ?? null);
  }

  return (
    <AdminLayout>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Users</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Everyone who has logged in with Discord. Toggling admin takes effect immediately, no restart needed.
        </p>
        <div className="table-scroll">
          <table id="users-table">
            {users?.length === 0 ? (
              <tbody>
                <tr>
                  <td>No one has logged in yet.</td>
                </tr>
              </tbody>
            ) : (
              <>
                <thead>
                  <tr>
                    <th></th>
                    <th>Username</th>
                    <th>Discord ID</th>
                    <th>Character</th>
                    <th>First login</th>
                    <th>Last login</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((user) => {
                    const isSelf = user.discordId === currentUser?.discordId;
                    const linkedWarriorIds = new Set(
                      users.filter((u) => u.linkedWarrior).map((u) => u.linkedWarrior!.id)
                    );
                    const unlinkedWarriors = warriors?.filter((w) => !linkedWarriorIds.has(w.id)) ?? [];
                    return (
                      <tr key={user.discordId}>
                        <td>
                          {user.avatar ? (
                            <img className="user-avatar" src={user.avatar} alt="" width={20} height={20} />
                          ) : (
                            <span className="user-avatar user-avatar-placeholder" />
                          )}
                        </td>
                        <td>{user.username}</td>
                        <td>{user.discordId}</td>
                        <td>
                          {user.linkedWarrior ? (
                            <>
                              {user.linkedWarrior.playerName}-{user.linkedWarrior.server}{" "}
                              <a
                                href="#"
                                className="text-link text-link-accent"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleUnlink(user);
                                }}
                              >
                                Unlink
                              </a>
                            </>
                          ) : (
                            <>
                              <select
                                value={linkSelection[user.discordId] ?? ""}
                                onChange={(e) =>
                                  setLinkSelection((prev) => ({ ...prev, [user.discordId]: Number(e.target.value) }))
                                }
                              >
                                <option value="" disabled>
                                  Select a warrior
                                </option>
                                {unlinkedWarriors.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.playerName}-{w.server}
                                  </option>
                                ))}
                              </select>{" "}
                              <a
                                href="#"
                                className="text-link text-link-accent"
                                aria-disabled={linkSelection[user.discordId] === undefined}
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (linkSelection[user.discordId] === undefined) return;
                                  handleLink(user);
                                }}
                              >
                                Link
                              </a>
                            </>
                          )}
                        </td>
                        <td>{fmtDateTime(user.firstLoginAt)}</td>
                        <td>{fmtDateTime(user.lastLoginAt)}</td>
                        <td>
                          <a
                            href="#"
                            className="text-link text-link-danger"
                            aria-disabled={isSelf && user.isAdmin}
                            title={isSelf && user.isAdmin ? "You can't revoke your own admin access" : undefined}
                            onClick={(e) => {
                              e.preventDefault();
                              if (isSelf && user.isAdmin) return;
                              toggleAdmin(user);
                            }}
                          >
                            {user.isAdmin ? "Revoke admin" : "Make admin"}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
