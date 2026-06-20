import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { View } from "react-native";
import { AnalogStick } from "@/features/gamepad/gamepad-controls";
import { MultiTouchProvider } from "@/hooks/useMultiTouch";

const mockOnMove = jest.fn();
const mockOnRelease = jest.fn();

// Mock measure to simulate layout position relative to root view
beforeAll(() => {
  jest.spyOn(View.prototype, "measure").mockImplementation((cb) => {
    // x=0, y=0, width=120, height=120, pageX=10, pageY=20
    cb(0, 0, 120, 120, 10, 20);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("AnalogStick", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders correctly", async () => {
    await render(
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

  it("handles movement via multi-touch dispatcher", async () => {
    const { getByTestId } = await render(
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
    await act(async () => {
      fireEvent(stickTrack!, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 120 } },
      });
    });

    // Touch start at center (70, 80)
    await act(async () => {
      fireEvent(provider, "touchStart", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 70, pageY: 80 }],
        },
      });
    });

    // Touch move to (87, 80) => dx=17, dy=0. radius=(120-52)/2=34.
    // axis x = (17/34)*100 = 50. axis y = 0
    await act(async () => {
      fireEvent(provider, "touchMove", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 87, pageY: 80 }],
        },
      });
    });
    expect(mockOnMove).toHaveBeenCalledWith(50, 0);

    // Touch end
    await act(async () => {
      fireEvent(provider, "touchEnd", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 87, pageY: 80 }],
        },
      });
    });
    expect(mockOnRelease).toHaveBeenCalled();
  });

  it("respects deadzone", async () => {
    await render(
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
    await act(async () => {
      fireEvent(stickTrack!, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: 120, height: 120 } },
      });
    });

    // Touch start at center
    await act(async () => {
      fireEvent(provider, "touchStart", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 70, pageY: 80 }],
        },
      });
    });

    // Move slightly (dx=2 => axis value = 2/34*100 = 6, which is < deadzone 10)
    await act(async () => {
      fireEvent(provider, "touchMove", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 72, pageY: 80 }],
        },
      });
    });
    // Should not call onMove for values inside deadzone
    expect(mockOnMove).not.toHaveBeenCalled();

    // Move further (dx=17 => axis value = 50, which is >= deadzone 10)
    await act(async () => {
      fireEvent(provider, "touchMove", {
        nativeEvent: {
          changedTouches: [{ identifier: 1, pageX: 87, pageY: 80 }],
        },
      });
    });
    expect(mockOnMove).toHaveBeenCalledWith(50, 0);
  });
});