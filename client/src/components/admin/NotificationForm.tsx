import { useEffect, useState } from "react";
import {
  createAdminNotification,
  getNotificationPublicLinks,
  updateAdminNotification,
  type AdminNotificationInput,
  type AdminNotificationView,
} from "../../api";
import { RichTextEditor } from "./RichTextEditor";

interface NotificationFormProps {
  notification: AdminNotificationView | null; // null = create mode
  onSaved: () => void;
  onClose: () => void;
}

export function NotificationForm({ notification, onSaved, onClose }: NotificationFormProps) {
  const isEdit = notification !== null;

  const [name, setName] = useState(notification?.name ?? "");
  const [content, setContent] = useState(notification?.content ?? "");
  const [buttonText, setButtonText] = useState(notification?.buttonText ?? "");
  const [buttonLink, setButtonLink] = useState(notification?.buttonLink ?? "");
  const [links, setLinks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getNotificationPublicLinks()
      .then(setLinks)
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const input: AdminNotificationInput = { name, content, buttonText, buttonLink };
    try {
      if (isEdit) {
        await updateAdminNotification(notification!.id, input);
      } else {
        await createAdminNotification(input);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim() !== "" && content.trim() !== "" && buttonText.trim() !== "" && buttonLink !== "";

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{isEdit ? `Edit ${notification!.name}` : "New Notification"}</h2>

      <label style={{ display: "block" }}>
        <span className="field-label">Name (admin-only label)</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
      </label>

      <label style={{ display: "block", marginTop: "0.75rem" }}>
        <span className="field-label">Content</span>
      </label>
      <RichTextEditor content={content} onChange={setContent} />

      <div className="config-grid" style={{ marginTop: "0.75rem" }}>
        <label>
          <span className="field-label">Button text</span>
          <input
            type="text"
            value={buttonText}
            onChange={(e) => setButtonText(e.target.value)}
            placeholder="Start Trading"
          />
        </label>
        <label>
          <span className="field-label">Button links to</span>
          <select value={buttonLink} onChange={(e) => setButtonLink(e.target.value)}>
            <option value="">Choose a page...</option>
            {links.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="status error">{error}</p>}

      <div className="card-footer">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving || !canSave}>
          {isEdit ? "Save changes" : "Create notification"}
        </button>
      </div>
    </div>
  );
}
