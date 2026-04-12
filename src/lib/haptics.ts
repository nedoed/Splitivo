import * as Haptics from 'expo-haptics';

export const haptics = {
  // Leichtes Tippen (Buttons, Auswahl)
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),

  // Mittleres Feedback (Bestätigung)
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),

  // Starkes Feedback (Wichtige Aktionen)
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),

  // Erfolg (grünes Checkmark Gefühl)
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),

  // Fehler (rotes X Gefühl)
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),

  // Warnung
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),

  // Selektion (Dropdown, Picker)
  selection: () => Haptics.selectionAsync(),
};
