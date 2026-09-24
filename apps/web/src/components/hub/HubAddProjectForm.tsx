import { type FormEvent, useEffect, useId, useState } from "react";

import type { HubProject } from "../../app/hub/hubProjects";
import { useT } from "../../app/providers/LocaleProvider";
import { canRegisterHubProjects, registerHubProject } from "../../runtime/hubProjectsClient";
import { ActionButton } from "../ui/ActionButton";

type HubAddProjectFormProps = {
  onRegistered: (project: HubProject) => void;
};

type Access = "checking" | "allowed" | "denied";

type Feedback = { tone: "success" | "error"; message: string } | null;

export const HubAddProjectForm = ({ onRegistered }: HubAddProjectFormProps) => {
  const t = useT();
  const inputId = useId();
  const [access, setAccess] = useState<Access>("checking");
  const [path, setPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Offering a form the hub will refuse only to fail on submit is worse than
  // pointing at the CLI up front.
  useEffect(() => {
    const controller = new AbortController();
    void canRegisterHubProjects(controller.signal).then((allowed) => {
      if (!controller.signal.aborted) {
        setAccess(allowed ? "allowed" : "denied");
      }
    });
    return () => {
      controller.abort();
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPath = path.trim();
    if (trimmedPath.length === 0 || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setFeedback(null);
    const result = await registerHubProject(trimmedPath);
    setIsSubmitting(false);

    if (result.kind === "denied") {
      setAccess("denied");
      return;
    }
    if (result.kind === "rejected") {
      setFeedback({ tone: "error", message: result.message });
      return;
    }
    setPath("");
    setFeedback({
      tone: "success",
      message: t(result.isNew ? "web.hub.add.registered" : "web.hub.add.alreadyRegistered", {
        name: result.project.name,
      }),
    });
    onRegistered(result.project);
  };

  if (access === "checking") {
    return null;
  }

  if (access === "denied") {
    return (
      <section className="hub-add-project" aria-label={t("web.hub.add.title")}>
        <h2 className="hub-section-title">{t("web.hub.add.title")}</h2>
        <p className="hub-add-project-hint">{t("web.hub.add.cliHint")}</p>
        <ul className="hub-cli-hints">
          <li>
            <code>octogent init</code> <span>{t("web.hub.add.cliInit")}</span>
          </li>
          <li>
            <code>octogent projects</code> <span>{t("web.hub.add.cliList")}</span>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="hub-add-project" aria-label={t("web.hub.add.title")}>
      <h2 className="hub-section-title">{t("web.hub.add.title")}</h2>
      <form
        className="hub-add-project-form"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label className="hub-add-project-label" htmlFor={inputId}>
          {t("web.hub.add.pathLabel")}
        </label>
        <div className="hub-add-project-row">
          <input
            autoComplete="off"
            className="hub-add-project-input"
            id={inputId}
            onChange={(event) => {
              setPath(event.target.value);
            }}
            placeholder={t("web.hub.add.placeholder")}
            spellCheck={false}
            type="text"
            value={path}
          />
          <ActionButton
            disabled={isSubmitting || path.trim().length === 0}
            type="submit"
            variant="primary"
          >
            {isSubmitting ? t("web.hub.add.submitting") : t("web.hub.add.submit")}
          </ActionButton>
        </div>
        <p className="hub-add-project-hint">{t("web.hub.add.hint")}</p>
        {feedback && (
          <p
            className="hub-add-project-feedback"
            data-tone={feedback.tone}
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        )}
      </form>
    </section>
  );
};
