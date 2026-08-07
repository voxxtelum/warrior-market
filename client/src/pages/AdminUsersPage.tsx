import { useEffect, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { getAdminUsers, setUserAdmin, type AdminUserRow } from "../api";

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);

  useEffect(() => {
    getAdminUsers().then(setUsers);
  }, []);

  function toggleAdmin(user: AdminUserRow) {
    const nowAdmin = !user.isAdmin;
    setUsers((prev) => prev?.map((u) => (u.discordId === user.discordId ? { ...u, isAdmin: nowAdmin } : u)) ?? null);
    setUserAdmin(user.discordId, nowAdmin);
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
                    <th>First login</th>
                    <th>Last login</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((user) => (
                    <tr key={user.discordId}>
                      <td>
                        {user.avatar ? (
                          <img className="user-avatar" src={user.avatar} alt="" width={28} height={28} />
                        ) : (
                          <span className="user-avatar user-avatar-placeholder" />
                        )}
                      </td>
                      <td>{user.username}</td>
                      <td>{user.discordId}</td>
                      <td>{fmtDateTime(user.firstLoginAt)}</td>
                      <td>{fmtDateTime(user.lastLoginAt)}</td>
                      <td>
                        <button type="button" onClick={() => toggleAdmin(user)}>
                          {user.isAdmin ? "Revoke admin" : "Make admin"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
