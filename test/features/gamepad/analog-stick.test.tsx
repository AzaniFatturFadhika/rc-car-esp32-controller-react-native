import { render, screen, fireEvent } from "@testing-library/react-native";
import { View } from "react-native";
import { AnalogStick } from "@/features/gamepad/gamepad-controls";
import { MultiTouchProvider } from "@/hooks/useMultiTouch";

const mockOnMove = jest.fn();
const mockOnRelease = jest.fn();

// Mock measureInWindow to simulate layout position in window
beforeAll(() => {
  jest.spyOn(View.prototype, "measureInWindow").mockImplementation((cb) => {
    // x=10, y=20, width=120, height=120 (center is at x=70, y=80)
    cb(10, 20, 120, 120);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("AnalogStick", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders correctly", () => {
    render(
      <MultiTouchProvider>
        <AnalogStick
          label="L"
          size={120}
          knobSize={52}
          onMove={mockOnMove}
          onRelease={mockOnRelease}
        />
      </MultiTouchProvider>
    );

    const stick = screen.getByText("L");
    expect(stick).toBeTruthy();
  });

  it("handles movement via multi-touch dispatcher", () => {
    const { getByTestId } = render(
      <MultiTouchProvider testID="provider">
        <AnalogStick
          label="L"
          size={120}
          knobSize={52}
          onMove={mockOnMove}
          onRelease={mockOnRelease}
        />
      </MultiTouchProvider>
    );

    const provider = getByTestId("provider");

    // Layout event to trigger measureInWindow
    const stickTrack = screen.getByText("L").parent?.parent;
    expect(stickTrack).toBeTruthy();
    fireEvent(stickTrack!, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 120 } },
    });

    // Touch start at center (70, 80)
    fireEvent(provider, "touchStart", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 70, pageY: 80 }],
      },
    });

    // Touch move to (87, 80) => dx=17, dy=0. radius=(120-52)/2=34.
    // axis x = (17/34)*100 = 50. axis y = 0
    fireEvent(provider, "touchMove", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 87, pageY: 80 }],
      },
    });
    expect(mockOnMove).toHaveBeenCalledWith(50, 0);

    // Touch end
    fireEvent(provider, "touchEnd", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 87, pageY: 80 }],
      },
    });
    expect(mockOnRelease).toHaveBeenCalled();
  });

  it("respects deadzone", () => {
    render(
      <MultiTouchProvider testID="provider">
        <AnalogStick
          label="L"
          size={120}
          knobSize={52}
          deadzone={10}
          onMove={mockOnMove}
          onRelease={mockOnRelease}
        />
      </MultiTouchProvider>
    );

    const provider = screen.getByTestId("provider");

    // Layout event to trigger measureInWindow
    const stickTrack = screen.getByText("L").parent?.parent;
    fireEvent(stickTrack!, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 120 } },
    });

    // Touch start at center
    fireEvent(provider, "touchStart", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 70, pageY: 80 }],
      },
    });

    // Move slightly (dx=2 => axis value = 2/34*100 = 6, which is < deadzone 10)
    fireEvent(provider, "touchMove", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 72, pageY: 80 }],
      },
    });
    // Should not call onMove for values inside deadzone
    expect(mockOnMove).not.toHaveBeenCalled();

    // Move further (dx=17 => axis value = 50, which is >= deadzone 10)
    fireEvent(provider, "touchMove", {
      nativeEvent: {
        changedTouches: [{ identifier: 1, pageX: 87, pageY: 80 }],
      },
    });
    expect(mockOnMove).toHaveBeenCalledWith(50, 0);
  });
});