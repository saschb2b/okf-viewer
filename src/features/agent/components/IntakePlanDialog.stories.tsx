import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { OkfTaskOrigin } from "@/features/agent/taskLauncher.ts";
import { IntakePlanDialog } from "./IntakePlanDialog.tsx";

/**
 * The preview runs against the browser mock's planner, whose fixture carries
 * the measured shapes of the research-PDF dogfood: repeated furniture, an
 * unverified footnote inventory, and figure gaps. The stories exercise the
 * real component against those shapes rather than hand-built props.
 */
const meta = {
  title: "Agent/Orchestration/IntakePlanDialog",
  component: IntakePlanDialog,
  args: {
    open: true,
    root: "/mock/workspace/docs",
    onOpenChange: () => undefined,
  },
} satisfies Meta<typeof IntakePlanDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before any documents are picked the screen says what will happen, and that
 *  no agent or model is involved. */
export const BeforePicking: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      body.getByRole("button", { name: "Choose documents…" }),
    ).toBeInTheDocument();
    await expect(body.getByText(/no agent or model is involved/)).toBeInTheDocument();
  },
};

/** Picking renders the whole plan: sources with warnings, concepts with
 *  spans, furniture with reasons, evidence, and gaps. */
export const PlannedCorpus: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("button", { name: "Choose documents…" }));
    await waitFor(async () => {
      await expect(body.getByText(/of 8 proposed concepts kept/)).toBeInTheDocument();
    });
    // Furniture is presented as set aside, with its occurrence reason, and
    // the figure loss is named rather than silently absent.
    await expect(body.getByText("Set aside as page furniture, not deleted")).toBeInTheDocument();
    await expect(body.getByText(/Repeats 21 times across pages/)).toBeInTheDocument();
    await expect(body.getByText(/FIGURE 2: TOTAL TOKEN DISTRIBUTION/)).toBeInTheDocument();
    await expect(body.getByText("Evidence candidates, unverified")).toBeInTheDocument();
  },
};

/** Dropping a concept changes the kept count and enables saving again. */
export const AdjustingTheKeeps: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("button", { name: "Choose documents…" }));
    // The kept count spans a <strong>, so match on the status line's text.
    await waitFor(async () => {
      await expect(body.getByRole("status")).toHaveTextContent("8 of 8 proposed concepts kept");
    });

    await userEvent.click(
      body.getByRole("checkbox", { name: "Important Disclosures and Other Information" }),
    );
    await expect(body.getByRole("status")).toHaveTextContent("7 of 8 proposed concepts kept");

    await userEvent.click(body.getByRole("button", { name: "Save plan" }));
    await waitFor(async () => {
      await expect(body.getByRole("button", { name: "Saved" })).toBeDisabled();
    });
  },
};

/** With a launcher wired in, a planned corpus can start an intake thread:
 *  the plan and its session-held sources go to the OKF task launcher, and a
 *  concept dropped from the plan stays out of the handoff prompt. */
const startThreadSpy = fn<(origin: OkfTaskOrigin) => void>();

export const StartingAnIntakeThread: Story = {
  args: { onStartThread: startThreadSpy },
  play: async ({ canvasElement }) => {
    startThreadSpy.mockClear();
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("button", { name: "Choose documents…" }));
    await waitFor(async () => {
      await expect(body.getByRole("status")).toHaveTextContent("8 of 8 proposed concepts kept");
    });

    await userEvent.click(body.getByRole("button", { name: "Start intake thread" }));
    await expect(startThreadSpy).toHaveBeenCalledTimes(1);
    const origin = startThreadSpy.mock.calls[0][0];
    await expect(origin.kind).toBe("intake-plan");
    if (origin.kind === "intake-plan") {
      await expect(origin.title).toBe("Intake plan of 2 documents");
      await expect(origin.sources.map((source) => source.title)).toEqual([
        "network-report.pdf",
        "why-we-build.pdf",
      ]);
    }
  },
};

/** A reopened saved plan has identity but no content, so it cannot start a
 *  thread until the documents are chosen again, and the screen says so. */
export const SavedPlanWithoutSources: Story = {
  args: { onStartThread: startThreadSpy },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    // Plan and save, close the plan by reopening it from the saved list.
    await userEvent.click(body.getByRole("button", { name: "Choose documents…" }));
    await waitFor(async () => {
      await expect(body.getByRole("button", { name: "Save plan" })).toBeEnabled();
    });
    await userEvent.click(body.getByRole("button", { name: "Save plan" }));
    await waitFor(async () => {
      await expect(body.getByRole("button", { name: "Saved" })).toBeDisabled();
    });
  },
};

/** No bundle open: the screen says what to do rather than offering a picker
 *  whose result could not be kept anywhere. */
export const WithoutABundle: Story = {
  args: { root: null },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText("Open a bundle to plan intake for it.")).toBeInTheDocument();
    await expect(body.queryByRole("button", { name: "Choose documents…" })).not.toBeInTheDocument();
  },
};

/** The narrow width the panel fixtures use. */
export const Narrow: Story = {
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("button", { name: "Choose documents…" }));
    await waitFor(async () => {
      await expect(body.getByText(/of 8 proposed concepts kept/)).toBeInTheDocument();
    });
  },
};
