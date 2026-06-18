import { render, screen, fireEvent } from '@testing-library/react-native';
import { AnalogStick } from '@/features/gamepad/gamepad-controls';
import { PanGesture } from 'react-native-gesture-handler';

const mockGesture = { 
  onUpdate: jest.fn(),
  onEnd: jest.fn(),
  onFinalize: jest.fn(),
} as unknown as PanGesture;

const mockOnMove = jest.fn();
const mockOnRelease = jest.fn();

describe('AnalogStick', () => {
  it('renders correctly', () => {
    render(
      <AnalogStick
        label='L'
        size={120}
        knobSize={52}
        gesture={mockGesture}
        onMove={mockOnMove}
        onRelease={mockOnRelease}
      />
    );

    const stick = screen.getByText('L');
    expect(stick).toBeTruthy();
  });

  it('handles movement with gesture', () => {
    render(
      <AnalogStick
        label='L'
        size={120}
        knobSize={52}
        gesture={mockGesture}
        onMove={mockOnMove}
        onRelease={mockOnRelease}
      />
    );

    const touch = screen.getByTestId('stick-track');
    fireEvent(touch, 'pointerDown', { x: 100, y: 100 });
    fireEvent(touch, 'pointerMove', { x: 150, y: 150 });
    fireEvent(touch, 'pointerUp');

    expect(mockOnMove).toHaveBeenCalledWith(50, 50);
    expect(mockOnRelease).toHaveBeenCalled();
  });

  it('respects deadzone', () => {
    render(
      <AnalogStick
        label='L'
        size={120}
        knobSize={52}
        deadzone={10}
        gesture={mockGesture}
        onMove={mockOnMove}
        onRelease={mockOnRelease}
      />
    );

    // Simulate movement within deadzone
    fireEvent(screen.getByTestId('stick-track'), 'pointerMove', { x: 10, y: 10 });
    fireEvent(screen.getByTestId('stick-track'), 'pointerMove', { x: 5, y: 5 });
    fireEvent(screen.getByTestId('stick-track'), 'pointerMove', { x: 0, y: 0 });

    // No movement should be sent
    expect(mockOnMove).not.toHaveBeenCalled();

    // Simulate movement outside deadzone
    fireEvent(screen.getByTestId('stick-track'), 'pointerMove', { x: 20, y: 20 });
    expect(mockOnMove).toHaveBeenCalledWith(20, 20);
  });
});