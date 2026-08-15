import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../authContext";
import { getActiveNotification, markNotificationViewed, type ActiveNotificationView } from "../api";
import { Modal } from "./Modal";

interface NotificationPopupProps {
  // Admin "Preview" mode: renders this notification directly instead of
  // fetching /api/notifications/active, and never calls markNotificationViewed
  // - purely for the admin to see what it looks like before activating it.
  previewNotification?: ActiveNotificationView;
  onClose?: () => void;
}

export function NotificationPopup({ previewNotification, onClose }: NotificationPopupProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fetched, setFetched] = useState<ActiveNotificationView | null>(null);
  const preview = previewNotification !== undefined;

  // Mirrors NotificationBanner: fetched once when `user` loads/changes, so a
  // user already mid-session when an admin activates a notification won't
  // see it until their next page load - same accepted limitation as the
  // existing wallet-notification banner.
  useEffect(() => {
    if (preview) return;
    if (!user) {
      setFetched(null);
      return;
    }
    getActiveNotification()
      .then(setFetched)
      .catch(() => setFetched(null));
  }, [user, preview]);

  const notification = preview ? previewNotification! : fetched;
  if (!notification) return null;

  function dismiss() {
    if (!preview) {
      markNotificationViewed(notification!.id).catch(() => {});
      setFetched(null);
    }
    onClose?.();
  }

  function handleCta() {
    if (!preview) {
      markNotificationViewed(notification!.id).catch(() => {});
      setFetched(null);
    }
    onClose?.();
    navigate(notification!.buttonLink);
  }

  return (
    <Modal title="" onClose={dismiss} contentClassName="notification-popup">
      <div className="notification-popup-body" dangerouslySetInnerHTML={{ __html: notification.content }} />
      <div className="card-footer">
        <button type="button" className="btn-affirm" onClick={handleCta}>
          {notification.buttonText}
        </button>
      </div>
      {preview && (
        <p className="subtitle" style={{ marginTop: "0.5rem" }}>
          Preview only - this won't be marked as seen.
        </p>
      )}
    </Modal>
  );
}
