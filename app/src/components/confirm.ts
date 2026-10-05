import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

function browserText(title: string, message: string | undefined): string {
  return message ? `${title}\n\n${message}` : title;
}

/**
 * Ask before an action and run it only after the user agrees. react-native-web implements
 * Alert.alert as an empty function, so a confirmation built on it silently did nothing in the
 * browser; there the browser's own dialog is used. Native platforms keep the Alert.
 */
export function confirmAction(options: ConfirmOptions, onConfirm: () => void): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function'
      && window.confirm(browserText(options.title, options.message))) {
      onConfirm();
    }
    return;
  }
  Alert.alert(options.title, options.message, [
    { text: options.cancelLabel ?? '取消', style: 'cancel' },
    { text: options.confirmLabel, style: options.destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

/** Show a message that needs no answer, in the browser as well. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(browserText(title, message));
    return;
  }
  Alert.alert(title, message);
}
