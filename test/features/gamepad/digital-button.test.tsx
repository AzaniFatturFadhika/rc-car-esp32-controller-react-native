import { render, screen, fireEvent } from "@testing-library/react-native";
import { View } from "react-native";
import { DigitalButton } from "@/features/gamepad/gamepad-controls";
import { MultiTouchProvider } from "@/hooks/useMultiTouch";

const mockOnPressIn = jest.fn();
const mockOnPressOut = jest.fn();

// Mock measureInWindow to simulate layout position in window
beforeAll(() => {
  jest.spyOn(View.prototype, "measureInWindow").mockImplementation((cb) => {
    // x=10, y=20, width=100, height=50
    cb(10, 20, 100, 50);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("DigitalButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders correctly", () => {
    render(
      <MultiTouchProvider>
        <DigitalButton
          label="A"
          accessibilityLabel="A button"
          active={false}
          variant="actionA"
          onPressIn={mockOnPressIn}
          onPressOut={mockOnPressOut}
        />
      </MultiTouchProvider>
    );

    const button = screen.getByText("A");
    expect(button).toBeTruthy();
  });

  it("handles press and release via multi-touch dispatcher", () => {
    const { getByTestId } = render(
      <MultiTouchProvider testID="provider">
        <DigitalButton
          label="A"
          accessibilityLabel="A button"
          active={false}
          variant="actionA"
          onPressIn={mockOnPressIn}
          onPressOut={mockOnPressOut}
        />
      </MultiTouchProvider>
    );

    const provider = getByTestId("provider");

    // Layout layout event to trigger measureInWindow
    const buttonView = screen.getByText("A").parent;
    fireEvent(buttonView, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 50 } },
    });

    // Touch start inside button bounds (10..110, 20..70)
    fireEvent(provider, "touchStart", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 15, pageY: 25 }],
      },
    });
    expect(mockOnPressIn).toHaveBeenCalled();

    // Touch end for same identifier
    fireEvent(provider, "touchEnd", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 15, pageY: 25 }],
      },
    });
    expect(mockOnPressOut).toHaveBeenCalled();
  });

  it("shows correct active state", () => {
    render(
      <MultiTouchProvider>
        <DigitalButton
          label="A"
          accessibilityLabel="A button"
          active={true}
          variant="actionA"
          onPressIn={mockOnPressIn}
          onPressOut={mockOnPressOut}
        />
      </MultiTouchProvider>
    );

    const button = screen.getByText("A");
    // Under our plain View refactoring, the active state adds the buttonActive style
    // which applies opacity=0.72 and transform=[{ scale: 0.96 }]
    expect(button.parent).toHaveStyle({ opacity: 0.72 });
    expect(button.parent).toHaveStyle({ transform: [{ scale: 0.96 }] });
  });
});