import { useEffect, useState } from "react";
import { useAuth } from "../authContext";
import { getNotifications, markNotificationRead, type NotificationView } from "../api";

export function NotificationBanner() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationView[]>([]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    getNotifications().then(setNotifications);
  }, [user]);

  if (!user || notifications.length === 0) return null;

  async function dismiss(id: number) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await markNotificationRead(id);
  }

  return (
    <div className="notification-banner-stack">
      {notifications.map((n) => (
        <div key={n.id} className="notification-banner">
          <span>{n.message}</span>
          <button type="button" onClick={() => dismiss(n.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
