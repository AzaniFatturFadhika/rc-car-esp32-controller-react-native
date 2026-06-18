import { render, screen, fireEvent } from '@testing-library/react-native';
import { DigitalButton } from '@/features/gamepad/gamepad-controls';

const mockOnPressIn = jest.fn();
const mockOnPressOut = jest.fn();

describe('DigitalButton', () => {
  it('renders correctly', () => {
    render(
      <DigitalButton
        label='A'
        accessibilityLabel='A button'
        active={false}
        variant='actionA'
        onPressIn={mockOnPressIn}
        onPressOut={mockOnPressOut}
      />
    );

    const button = screen.getByText('A');
    expect(button).toBeTruthy();
  });

  it('handles press and release', () => {
    render(
      <DigitalButton
        label='A'
        accessibilityLabel='A button'
        active={false}
        variant='actionA'
        onPressIn={mockOnPressIn}
        onPressOut={mockOnPressOut}
      />
    );

    // Simulate press
    fireEvent.press(screen.getByText('A'));
    expect(mockOnPressIn).toHaveBeenCalledWith();
    expect(screen.getByText('A')).toBeTruthy();

    // Simulate release
    fireEvent.press(screen.getByText('A'));
    expect(mockOnPressOut).toHaveBeenCalledWith();
  });

  it('shows correct active state', () => {
    render(
      <DigitalButton
        label='A'
        accessibilityLabel='A button'
        active={true}
        variant='actionA'
        onPressIn={mockOnPressIn}
        onPressOut={mockOnPressOut}
      />
    );

    const button = screen.getByText('A');
    expect(button).toHaveStyle({ opacity: 0.72 });
    expect(button).toHaveStyle({ transform: [{ scale: 0.96 }] });
  });
});