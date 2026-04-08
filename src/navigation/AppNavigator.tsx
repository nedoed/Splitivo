import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text } from 'react-native';

import GroupsScreen from '../screens/GroupsScreen';
import GroupDetailScreen from '../screens/GroupDetailScreen';
import AddExpenseScreen from '../screens/AddExpenseScreen';
import ActivityScreen from '../screens/ActivityScreen';
import SettleScreen from '../screens/SettleScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

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
    </Stack.Navigator>
  );
}

const TAB_ICONS: { [key: string]: { active: string; inactive: string } } = {
  Gruppen: { active: '👥', inactive: '👤' },
  Aktivität: { active: '📋', inactive: '📋' },
  Abrechnen: { active: '💸', inactive: '💰' },
  Profil: { active: '👤', inactive: '🙂' },
};

export default function AppNavigator() {
  return (
    <Tab.Navigator
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
          paddingBottom: 6,
          height: 60,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Gruppen" component={GroupsStack} />
      <Tab.Screen name="Aktivität" component={ActivityScreen} />
      <Tab.Screen name="Abrechnen" component={SettleScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
