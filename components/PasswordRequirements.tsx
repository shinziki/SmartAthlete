import { PASSWORD_RULES } from '@/lib/passwordValidation';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

type Props = {
    password: string;
};

export default function PasswordRequirements({ password }: Props) {
    return (
        <View style={styles.container}>
            {PASSWORD_RULES.map((rule) => {
                const passed = rule.test(password);
                const color = passed ? '#2E7D32' : '#D32F2F';
                return (
                    <View key={rule.key} style={styles.row}>
                        <Icon
                            source={passed ? 'check-circle' : 'close-circle'}
                            size={16}
                            color={color}
                        />
                        <Text variant="bodySmall" style={[styles.label, { color }]}>
                            {rule.label}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 12,
        marginTop: -4,
        paddingHorizontal: 4,
    },
    row: {
        alignItems: 'center',
        flexDirection: 'row',
        marginVertical: 2,
    },
    label: {
        marginLeft: 6,
    },
});