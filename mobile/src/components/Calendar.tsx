import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { PressScale } from '@/components/PressScale';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, type } from '@/theme/tokens';
import {
  todayOrDefault, monthHeight, monthIndexFor, monthOffset, monthsInRange,
  dayLabel, cellRole, MONTH_GAP, MONTH_HEADER_HEIGHT, ROW_HEIGHT,
  type Selection, type Month, type CellRole,
} from '@/features/trips/calendar';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// The visible circle is smaller than its cell: the cell is the touch target
// and measures ROW_HEIGHT by a seventh of the grid width, both above the
// 44 pt from Apple's Human Interface Guidelines. A fixed diameter also stays
// a circle regardless of device width, instead of an oval.
const CIRCLE = 40;

type Props = {
  selection: Selection;
  onDayPress: (day: string) => void;
  // Without this entry point, every test would hang on the real system date
  // and break in the following month (same pattern as
  // todaysCalendarDay(now = new Date())).
  today?: string;
};

export function Calendar({ selection, onDayPress, today }: Props) {
  const { colors } = useTheme();
  const todayIso = todayOrDefault(today);
  const months = useMemo(() => monthsInRange(todayIso), [todayIso]);
  const firstDay = months[0].weeks.flat().find(Boolean) as string;
  const lastDay = months[months.length - 1].weeks.flat().filter(Boolean).pop() as string;

  // Only the first render jumps, after that the user scrolls themselves.
  // As a lazy initializer instead of a ref: the value is computed exactly once
  // and stays constant after that, without a ref being read during render.
  const [startIndex] = useState(() => monthIndexFor(months, selection.start ?? todayIso));

  return (
    // Fills the parent instead of giving itself a height. That requires the
    // parent to HAVE a definite height: inside `Sheet`, whose content has none,
    // the calendar stood zero tall in the tree and was invisible. That's why
    // `DateRangeField` puts it in a full-screen modal instead.
    <View testID="calendar" style={{ flex: 1 }}>
      <View testID="calendar-weekdays" style={{ flexDirection: 'row', paddingBottom: spacing.s }}>
        {WEEKDAYS.map((day) => (
          <Text
            key={day}
            style={[type.label, { flex: 1, textAlign: 'center', color: colors['text-2'] }]}
          >
            {day}
          </Text>
        ))}
      </View>
      <FlatList
        testID="calendar-months"
        style={{ flex: 1 }}
        data={months}
        keyExtractor={(m) => `${m.year}-${m.month}`}
        initialScrollIndex={startIndex}
        initialNumToRender={3}
        getItemLayout={(_, index) => ({
          length: monthHeight(months[index]),
          offset: monthOffset(months, index),
          index,
        })}
        renderItem={({ item }) => (
          <MonthBlock
            month={item}
            selection={selection}
            onDayPress={onDayPress}
            today={todayIso}
            firstDay={firstDay}
            lastDay={lastDay}
          />
        )}
      />
    </View>
  );
}

function MonthBlock({
  month, selection, onDayPress, today, firstDay, lastDay,
}: {
  month: Month;
  selection: Selection;
  onDayPress: (day: string) => void;
  today: string;
  firstDay: string;
  lastDay: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: MONTH_GAP }}>
      <View style={{ height: MONTH_HEADER_HEIGHT, justifyContent: 'center' }}>
        <Text style={[type.h3, { color: colors['text-1'] }]}>{month.title}</Text>
      </View>
      {month.weeks.map((week, i) => (
        <View key={i} style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
          {week.map((day, j) =>
            day === null ? (
              <View key={`leer-${j}`} style={{ flex: 1 }} />
            ) : (
              <DayCell
                key={day}
                day={day}
                role={cellRole(day, selection, firstDay, lastDay)}
                isToday={day === today}
                onDayPress={onDayPress}
              />
            )
          )}
        </View>
      ))}
    </View>
  );
}

function DayCell({
  day, role, isToday, onDayPress,
}: {
  day: string;
  role: CellRole;
  isToday: boolean;
  onDayPress: (day: string) => void;
}) {
  const { colors } = useTheme();
  const filled = role === 'beginn' || role === 'ende' || role === 'einzeln';
  const locked = role === 'gesperrt';
  const numberColor = filled ? colors['bg-0'] : locked ? colors['text-3'] : colors['text-1'];

  // The span reaches from the cell's center to its outer edge, not just to
  // the circle's edge: otherwise a gap opens in the bar between the start
  // and the first day of the span.
  const span =
    role === 'dazwischen' ? { left: 0, right: 0 }
    : role === 'beginn' ? { left: '50%' as const, right: 0 }
    : role === 'ende' ? { left: 0, right: '50%' as const }
    : null;

  return (
    // The span sits NEXT TO the press target, not inside it. `PressScale`
    // passes its `style` on to the Pressable, but wraps the children in an
    // Animated.View without a style (PressScale.tsx:39), and that shrinks to
    // its content, i.e. to the circle. Placed inside, the span would
    // therefore measure 40 instead of the full cell width: a gap opened
    // between two days of the span, and the half spans at start and end
    // stopped at the circle's edge. As a side effect, this way only the
    // circle scales on press, not the bar.
    <View style={{ flex: 1 }}>
      {span ? (
        <View
          testID={`span-${day}`}
          style={{
            position: 'absolute',
            top: (ROW_HEIGHT - CIRCLE) / 2,
            height: CIRCLE,
            backgroundColor: colors['bg-1'],
            ...span,
          }}
        />
      ) : null}
      <PressScale
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        accessibilityRole="button"
        accessibilityLabel={dayLabel(day)}
        accessibilityState={{ selected: filled || role === 'dazwischen', disabled: locked }}
        disabled={locked}
        onPress={() => onDayPress(day)}
      >
        <View
          style={{
            width: CIRCLE,
            height: CIRCLE,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: filled ? colors['text-1'] : 'transparent',
          }}
        >
          <Text style={[type.body, { color: numberColor }]}>{Number(day.slice(8))}</Text>
          {isToday ? (
            <View
              style={{
                position: 'absolute',
                bottom: 6,
                width: 4,
                height: 4,
                borderRadius: radius.pill,
                backgroundColor: filled ? colors['bg-0'] : colors['text-2'],
              }}
            />
          ) : null}
        </View>
      </PressScale>
    </View>
  );
}
