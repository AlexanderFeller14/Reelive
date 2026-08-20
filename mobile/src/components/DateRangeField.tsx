import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button } from '@/components/Button';
import { Calendar } from '@/components/Calendar';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { palette, radius, spacing, type } from '@/theme/tokens';
import { useTopInset, useBottomInset } from '@/theme/useTopInset';
import { nextSelection, rangeLabel, type Selection } from '@/features/trips/calendar';
import { formatRange } from '@/features/trips/tripDay';

type Props = {
  value: Selection;
  onChange: (selection: Selection) => void;
  error?: string;
  today?: string;
};

// The field carries the dimensions of `Input` (DESIGN-LANGUAGE §4), but isn't
// a text field: since the move to the calendar there's no text path left, so
// instead it's a surface that opens the sheet.
export function DateRangeField({ value, onChange, error, today }: Props) {
  const { colors } = useTheme();
  // The modal covers the entire page and therefore touches both system areas:
  // the status bar and Dynamic Island above, the home indicator below. A
  // fixed bottom spacing would leave "Übernehmen" stranded underneath it.
  const top = useTopInset(spacing.l);
  const bottom = useBottomInset(spacing.l);
  const [open, setOpen] = useState(false);
  // The draft only lives as long as the sheet is open. Only "Übernehmen"
  // reports it upward, canceling discards it without consequence. That's why
  // `openField` sets it fresh from `value` every time, instead of relying on
  // the state from last time.
  const [draft, setDraft] = useState<Selection>(value);

  const complete = !!draft.start && !!draft.end;
  const display = value.start && value.end ? formatRange(value.start, value.end) : '';

  const openField = () => {
    setDraft(value);
    setOpen(true);
  };

  const apply = () => {
    if (!complete) return;
    onChange(draft);
    setOpen(false);
  };

  return (
    <View style={{ gap: spacing.xs }}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={rangeLabel(value)}
        onPress={openField}
        style={{
          height: 56,
          borderWidth: 1,
          borderColor: error ? palette.danger : colors['line-strong'],
          borderRadius: radius.control,
          backgroundColor: colors['bg-0'],
          paddingHorizontal: spacing.base,
          justifyContent: 'center',
        }}
      >
        <Text style={[type.label, { color: colors['text-2'] }]}>Zeitraum</Text>
        {display ? <Text style={[type.body, { color: colors['text-1'] }]}>{display}</Text> : null}
      </PressScale>
      {error ? <Text style={[type.secondary, { color: palette.danger }]}>{error}</Text> : null}

      {/* A Modal, not a `Sheet`. Two reasons: `Sheet` positions itself with
          absoluteFill relative to its parent, and this field sits in the
          middle of the form, so the sheet appeared at the field's position
          and covered the status bar. And `Sheet` gives its content no
          definite height, the calendar stood zero tall inside it. The Modal
          solves both: it always sits on top and carries a full height.
          `pageSheet` comes up from below and can be swiped away downward,
          which is the same presentation DESIGN-LANGUAGE §4 specifies for
          sheets. */}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View
          testID="date-range-modal"
          style={{
            flex: 1,
            backgroundColor: colors['bg-0'],
            paddingTop: top,
            paddingHorizontal: spacing.screen,
            paddingBottom: bottom,
            gap: spacing.base,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
            <PressScale
              accessibilityRole="button"
              accessibilityLabel="Schliessen"
              onPress={() => setOpen(false)}
              hitSlop={spacing.m}
            >
              <X size={24} strokeWidth={1.75} color={colors['text-1']} />
            </PressScale>
            <Text style={[type.h3, { color: colors['text-1'] }]}>Zeitraum</Text>
          </View>
          <Calendar
            selection={draft}
            onDayPress={(day) => setDraft((previous) => nextSelection(previous, day))}
            today={today}
          />
          <Button
            variant="primary"
            label="Übernehmen"
            onPress={apply}
            disabled={!complete}
          />
        </View>
      </Modal>
    </View>
  );
}
