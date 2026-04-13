import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Platform, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics } from '../lib/haptics';

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

const HEADER_OPTIONS = {
  headerStyle: { backgroundColor: '#fff', elevation: 0, shadowOpacity: 0 },
  headerTitleStyle: { fontWeight: '700' as const, color: '#1a1a2e', fontSize: 18 },
  headerTintColor: '#6C63FF',
};

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={HEADER_OPTIONS}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: 'Freunde' }} />
    </Stack.Navigator>
  );
}

function GroupsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#fff', elevation: 0, shadowOpacity: 0 },
        headerTitleStyle: { fontWeight: '700', color: '#1a1a2e', fontSize: 18 },
        headerTintColor: '#6C63FF',
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
  // Auf Android mit edgeToEdgeEnabled muss die Tab-Bar den System-Navigationsbereich
  // (Zurück/Home/Übersicht) nach unten ausweichen. insets.bottom gibt den genauen Wert.
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
        tabBarActiveTintColor: '#6C63FF',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopWidth: 0,
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
