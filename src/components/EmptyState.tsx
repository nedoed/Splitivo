import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface EmptyStateProps {
  emoji: string;
  title: string;
  subtitle: string;
  buttonText?: string;
  onButtonPress?: () => void;
}

export default function EmptyState({
  emoji,
  title,
  subtitle,
  buttonText,
  onButtonPress,
}: EmptyStateProps) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        paddingBottom: 60,
      }}
    >
      <View
        style={{
          width: 120,
          height: 120,
          borderRadius: 60,
          backgroundColor: '#F0EEFF',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Text style={{ fontSize: 56 }}>{emoji}</Text>
      </View>

      <Text
        style={{
          fontSize: 22,
          fontWeight: 'bold',
          color: '#1a1a2e',
          textAlign: 'center',
          marginBottom: 12,
        }}
      >
        {title}
      </Text>

      <Text
        style={{
          fontSize: 15,
          color: '#888',
          textAlign: 'center',
          lineHeight: 22,
          marginBottom: 32,
        }}
      >
        {subtitle}
      </Text>

      {buttonText && onButtonPress && (
        <TouchableOpacity
          style={{
            backgroundColor: '#6C63FF',
            paddingHorizontal: 32,
            paddingVertical: 14,
            borderRadius: 25,
            shadowColor: '#6C63FF',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 4,
          }}
          onPress={onButtonPress}
          activeOpacity={0.85}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
            {buttonText}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
