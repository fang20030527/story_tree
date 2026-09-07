import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { weight } from '@/constants/theme';
import { useAppTheme } from '@/context/ThemeContext';

import {
  type VocabularyDraftField,
  type VocabularyDraftRow,
  validateVocabularyDraft,
} from './practiceDraft';

const EMPTY_ROW: VocabularyDraftRow = {
  term: '',
  meaningZh: '',
  sourceSentence: '',
};

interface VocabularyInputListProps {
  value: VocabularyDraftRow[];
  onChange: (rows: VocabularyDraftRow[]) => void;
  validationAttempted: boolean;
  disabled?: boolean;
}

export function VocabularyInputList({
  value,
  onChange,
  validationAttempted,
  disabled = false,
}: VocabularyInputListProps) {
  const { theme } = useAppTheme();
  const [expandedRows, setExpandedRows] = useState<Set<number>>(
    () => new Set(),
  );
  const [touchedFields, setTouchedFields] = useState<Set<string>>(
    () => new Set(),
  );
  const validation = useMemo(
    () => validateVocabularyDraft(value),
    [value],
  );

  const updateField = (
    rowIndex: number,
    field: VocabularyDraftField,
    fieldValue: string,
  ) => {
    onChange(value.map((row, index) => (
      index === rowIndex ? { ...row, [field]: fieldValue } : row
    )));
  };

  const markTouched = (
    rowIndex: number,
    field: VocabularyDraftField,
  ) => {
    setTouchedFields((current) => {
      const next = new Set(current);
      next.add(`${rowIndex}:${field}`);
      return next;
    });
  };

  const showError = (
    rowIndex: number,
    field: VocabularyDraftField,
  ): string | undefined => {
    if (
      !validationAttempted
      && !touchedFields.has(`${rowIndex}:${field}`)
    ) {
      return undefined;
    }
    return validation.rowErrors[rowIndex]?.[field];
  };

  const toggleSourceSentence = (rowIndex: number) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const removeRow = (rowIndex: number) => {
    if (value.length <= 1) return;
    onChange(value.filter((_, index) => index !== rowIndex));
    setExpandedRows(new Set());
    setTouchedFields(new Set());
  };

  return (
    <View style={styles.list}>
      {value.map((row, rowIndex) => {
        const termError = showError(rowIndex, 'term');
        const meaningError = showError(rowIndex, 'meaningZh');
        const sourceError = showError(rowIndex, 'sourceSentence');
        const sourceExpanded = expandedRows.has(rowIndex)
          || Boolean(row.sourceSentence);

        return (
          <View
            key={rowIndex}
            style={[
              styles.row,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
              },
            ]}>
            <View style={styles.rowHeader}>
              <Text style={[styles.rowTitle, { color: theme.text }]}>
                义项 {rowIndex + 1}
              </Text>
              <TouchableOpacity
                accessibilityLabel={`删除第 ${rowIndex + 1} 个义项`}
                disabled={disabled || value.length === 1}
                hitSlop={8}
                onPress={() => removeRow(rowIndex)}>
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={value.length === 1 ? theme.textMuted : theme.danger}
                />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: theme.textSecondary }]}>单词或短语</Text>
            <TextInput
              accessibilityLabel={`第 ${rowIndex + 1} 个单词或短语`}
              autoCapitalize="none"
              editable={!disabled}
              maxLength={80}
              onBlur={() => markTouched(rowIndex, 'term')}
              onChangeText={(text) => updateField(rowIndex, 'term', text)}
              placeholder="例如 resilient"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                {
                  borderColor: termError ? theme.danger : theme.border,
                  color: theme.text,
                },
              ]}
              value={row.term}
            />
            {termError ? (
              <Text style={[styles.error, { color: theme.danger }]}>{termError}</Text>
            ) : null}

            <Text style={[styles.label, { color: theme.textSecondary }]}>具体中文义项</Text>
            <TextInput
              accessibilityLabel={`第 ${rowIndex + 1} 个具体中文义项`}
              editable={!disabled}
              maxLength={200}
              onBlur={() => markTouched(rowIndex, 'meaningZh')}
              onChangeText={(text) => updateField(rowIndex, 'meaningZh', text)}
              placeholder="例如 有韧性的"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                {
                  borderColor: meaningError ? theme.danger : theme.border,
                  color: theme.text,
                },
              ]}
              value={row.meaningZh}
            />
            {meaningError ? (
              <Text style={[styles.error, { color: theme.danger }]}>{meaningError}</Text>
            ) : null}

            <TouchableOpacity
              disabled={disabled}
              onPress={() => toggleSourceSentence(rowIndex)}
              style={styles.sourceToggle}>
              <Ionicons
                name={sourceExpanded ? 'chevron-up' : 'add'}
                size={16}
                color={theme.blue}
              />
              <Text style={[styles.sourceToggleText, { color: theme.blue }]}>
                {sourceExpanded ? '收起原句' : '添加原句（可选）'}
              </Text>
            </TouchableOpacity>

            {sourceExpanded ? (
              <>
                <TextInput
                  accessibilityLabel={`第 ${rowIndex + 1} 个英文原句`}
                  editable={!disabled}
                  maxLength={1_000}
                  multiline
                  onBlur={() => markTouched(rowIndex, 'sourceSentence')}
                  onChangeText={(text) => updateField(
                    rowIndex,
                    'sourceSentence',
                    text,
                  )}
                  placeholder="粘贴遇到这个义项时的英文原句"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.input,
                    styles.sourceInput,
                    {
                      borderColor: sourceError ? theme.danger : theme.border,
                      color: theme.text,
                    },
                  ]}
                  textAlignVertical="top"
                  value={row.sourceSentence}
                />
                {sourceError ? (
                  <Text style={[styles.error, { color: theme.danger }]}>
                    {sourceError}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        );
      })}

      <TouchableOpacity
        accessibilityLabel="添加一个义项"
        disabled={disabled || value.length >= 10}
        onPress={() => onChange([...value, { ...EMPTY_ROW }])}
        style={[
          styles.addButton,
          {
            backgroundColor: theme.surfaceAlt,
            borderColor: theme.border,
            opacity: disabled || value.length >= 10 ? 0.5 : 1,
          },
        ]}>
        <Ionicons name="add-circle-outline" size={19} color={theme.blue} />
        <Text style={[styles.addButtonText, { color: theme.blue }]}>添加义项</Text>
        <Text style={[styles.rowCount, { color: theme.textMuted }]}>
          {value.length}/10
        </Text>
      </TouchableOpacity>

      {validationAttempted && validation.formError ? (
        <Text style={[styles.formError, { color: theme.danger }]}>
          {validation.formError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  row: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  rowTitle: { fontSize: 16, fontWeight: weight('semibold') },
  label: { fontSize: 13, marginBottom: 6, marginTop: 8 },
  input: {
    borderRadius: 9,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sourceInput: { minHeight: 92 },
  error: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  sourceToggle: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
    marginTop: 12,
    paddingVertical: 4,
  },
  sourceToggleText: { fontSize: 13, fontWeight: weight('medium') },
  addButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  addButtonText: {
    flex: 1,
    fontSize: 14,
    fontWeight: weight('semibold'),
    marginLeft: 7,
  },
  rowCount: { fontSize: 12 },
  formError: { fontSize: 13, textAlign: 'center' },
});
