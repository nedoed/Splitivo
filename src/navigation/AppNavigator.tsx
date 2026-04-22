import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Platform, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics } from '../lib/haptics';
import { useTheme } from '../lib/ThemeContext';

import GroupsScreen from '../screens/GroupsScreen';
import GroupDetailScreen from '../screens/GroupDetailScreen';
import AddExpenseScreen from '../screens/AddExpenseScreen';
import ExpenseDetailScreen from '../screens/ExpenseDetailScreen';
import ReceiptSplitScreen from '../screens/ReceiptSplitScreen';
import ActivityScreen from '../screens/ActivityScreen';
import SettleScreen from '../screens/SettleScreen';
import SpesaScreen from '../screens/SpesaScreen';
import ProfileScreen from '../screens/ProfileScreen';
import FriendsScreen from '../screens/FriendsScreen';
import StatsScreen from '../screens/StatsScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function ProfileStack() {
  const { theme } = useTheme();
  const headerOptions = {
    headerStyle: { backgroundColor: theme.card, elevation: 0, shadowOpacity: 0 },
    headerTitleStyle: { fontWeight: '700' as const, color: theme.text, fontSize: 18 },
    headerTintColor: theme.primary,
  };
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: 'Freunde' }} />
    </Stack.Navigator>
  );
}

function GroupsStack() {
  const { theme } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.card, elevation: 0, shadowOpacity: 0 },
        headerTitleStyle: { fontWeight: '700', color: theme.text, fontSize: 18 },
        headerTintColor: theme.primary,
      }}
    >
      <Stack.Screen name="GroupsList" component={GroupsScreen} options={{ title: 'Gruppen', headerShown: false }} />
      <Stack.Screen
        name="GroupDetail"
        component={GroupDetailScreen}
        options={({ route }: any) => ({ title: route.params?.group?.name ?? 'Gruppe' })}
      />
      <Stack.Screen name="AddExpense" component={AddExpenseScreen} options={{ title: 'Ausgabe hinzufügen' }} />
      <Stack.Screen name="ExpenseDetail" component={ExpenseDetailScreen} options={{ title: 'Ausgabe' }} />
      <Stack.Screen name="ReceiptSplit" component={ReceiptSplitScreen} options={{ title: 'Kassenbon aufteilen' }} />
    </Stack.Navigator>
  );
}

const TAB_ICONS: { [key: string]: { active: string; inactive: string } } = {
  Gruppen: { active: '👥', inactive: '👤' },
  Aktivität: { active: '📋', inactive: '📋' },
  Statistiken: { active: '📊', inactive: '📈' },
  Abrechnen: { active: '💸', inactive: '💰' },
  Spesen: { active: '💼', inactive: '💼' },
  Profil: { active: '👤', inactive: '🙂' },
};

export default function AppNavigator() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const bottomInset = Platform.OS === 'android'
    ? Math.max(insets.bottom, 16)
    : insets.bottom;
  const TAB_HEIGHT = 62;

  return (
    <Tab.Navigator
      screenListeners={{
        tabPress: () => haptics.light(),
      }}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => {
          const icons = TAB_ICONS[route.name] ?? { active: '•', inactive: '•' };
          return <Text style={{ fontSize: 22 }}>{focused ? icons.active : icons.inactive}</Text>;
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopWidth: 0.5,
          borderTopColor: theme.tabBarBorder,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.06,
          shadowRadius: 12,
          elevation: 10,
          paddingBottom: bottomInset,
          height: TAB_HEIGHT + bottomInset,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Gruppen" component={GroupsStack} />
      <Tab.Screen name="Aktivität" component={ActivityScreen} />
      <Tab.Screen name="Statistiken" component={StatsScreen} />
      <Tab.Screen name="Abrechnen" component={SettleScreen} />
      <Tab.Screen name="Spesen" component={SpesaScreen} />
      <Tab.Screen name="Profil" component={ProfileStack} />
    </Tab.Navigator>
  );
}
