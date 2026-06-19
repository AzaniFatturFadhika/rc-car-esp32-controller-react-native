import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { View } from "react-native";
import { DigitalButton } from "@/features/gamepad/gamepad-controls";
import { MultiTouchProvider } from "@/hooks/useMultiTouch";

const mockOnPressIn = jest.fn();
const mockOnPressOut = jest.fn();

// Mock measure to simulate layout position relative to root view
beforeAll(() => {
  jest.spyOn(View.prototype, "measure").mockImplementation((cb) => {
    // x=0, y=0, width=100, height=50, pageX=10, pageY=20
    cb(0, 0, 100, 50, 10, 20);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("DigitalButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders correctly", async () => {
    await render(
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

  it("handles press and release via multi-touch dispatcher", async () => {
    const { getByTestId } = await render(
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
    await act(async () => {
      fireEvent(buttonView!, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 50 } },
      });
    });

    // Touch start inside button bounds (10..110, 20..70)
    await act(async () => {
      fireEvent(provider, "touchStart", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 15, pageY: 25 }],
        },
      });
    });
    expect(mockOnPressIn).toHaveBeenCalled();

    // Touch end for same identifier
    await act(async () => {
      fireEvent(provider, "touchEnd", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 15, pageY: 25 }],
        },
      });
    });
    expect(mockOnPressOut).toHaveBeenCalled();
  });

  it("shows correct active state", async () => {
    await render(
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