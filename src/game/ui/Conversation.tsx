/**
 * A conversation, where the hand of cards sits: along the bottom of the screen, across the room the
 * cards were using. While it is open the table is talking, not acting - the Jump and Rest keys and
 * the cards step aside for it (`ActionBar`), the camera is held on whoever is being talked to
 * (`CameraFocus`), and the Light, the Shadow and the Loadout stay where they are.
 *
 * What was said is on the left, the replies on the right, so a long answer and a long list of
 * replies both have room. The same `dialogue` box the play panel used to show, and the same
 * buttons, so what clicks it and what tests read it are unchanged.
 */

import type { DialogueView } from '../../engine/dialogue/dialogue';
import type { Response } from '../../engine/script/runner';

/** A conversation as shown: `held` when it cannot go on yet, and why - a shop it opened is open. */
export type TalkingView = DialogueView & { held?: string };

export interface ConversationProps {
  view: TalkingView;
  onAnswer: (response: Response) => void;
}

export function Conversation(props: ConversationProps): preact.JSX.Element {
  const { view } = props;
  return (
    <div className="play-box panel-box conversation" data-testid="dialogue">
      <div className="conversation-said">
        {view.lines.map((line, i) => (
          <div key={i} className="conversation-line">
            {line.speaker !== undefined ? <span className="panel-speaker">{line.speaker}: </span> : null}
            <span className="panel-prose">{line.text}</span>
          </div>
        ))}
      </div>
      <div className="conversation-replies">
        {view.held !== undefined ? <div className="panel-detail conversation-held" data-testid="dialogue-held">{view.held}</div> : null}
        {view.options.map((option) => (
          <button
            key={option.index}
            disabled={!option.enabled || view.held !== undefined}
            title={view.held ?? (option.enabled ? undefined : 'Not available')}
            className="play-btn panel-option"
            onClick={() => props.onAnswer({ kind: 'choose', index: option.index })}
          >
            {option.text}
            {option.detail !== undefined ? <span className="panel-detail"> — {option.detail}</span> : null}
          </button>
        ))}
        {view.options.length === 0 ? (
          <button className="play-btn is-primary" disabled={view.held !== undefined} onClick={() => props.onAnswer({ kind: 'continue' })}>
            Continue
          </button>
        ) : null}
      </div>
    </div>
  );
}
