let permissionGranted = Notification.permission === "granted";

export function requestNotificationPermission() {
  if (Notification.permission === "default") {
    Notification.requestPermission().then((p) => {
      permissionGranted = p === "granted";
    });
  }
}

export function sendNotification(title: string, body: string) {
  if (!permissionGranted || document.hasFocus()) return;
  try {
    new Notification(title, {
      body,
      icon: undefined,
      silent: false,
    });
  } catch {
    /* ignore */
  }
}
