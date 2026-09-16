/**
 * The editor: a top bar of modes over the board, and whatever the mode in hand
 * needs around the edges.
 *
 * It replaces the side panel that carried every tool and every form in one
 * scrolling column. The shape is the TaleSpire one the user asked for: tools on
 * a rail, things to put down in a strip along the bottom, properties on the
 * right, and each mode showing only its own. The long-lived editors (party,
 * cards, items, quests, code, models, a conversation) open as workspaces under
 * the bar, which stays put, so the way back is always on screen.
 *
 * Thin on purpose, like the panel it replaces. Which tools a mode owns and what
 * a click means are `modes.ts` and `controller.ts`; what the strip offers is
 * `library.ts`. This file arranges them.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import './editor.css';
import { SRD_CONDITIONS } from '../../engine/content/conditions';
import { STARTER_CONDITIONS } from '../../engine/content/pack/starter';
import type { AbilityDef } from '../../engine/content/abilities';
import type { AdversaryDef } from '../../engine/content/types';
import type { CardDef, ContentPack } from '../../engine/content/pack/import';
import type { Interactable } from '../../engine/scene/schema';
import type { EditorController, EditorTool } from '../controller';
import type { EditorSession } from '../session';
import { EDITOR_MODES, MODE_TOOLS, TERRAIN_RAIL, isTerrainTab, type EditorMode } from '../modes';
import { BUILD_SHAPES } from '../../engine/scene/building';
import { buildingTab, creatureTabs, groundTab, objectsTab, propsTab, type LibraryItem } from '../library';
import { validateProject, type Problem } from '../validate';
import { TopBar, type Menu, type Workspace } from './TopBar';
import { SceneMenu } from './SceneMenu';
import { ToolRail } from './ToolRail';
import { LibraryStrip } from './LibraryStrip';
import {
  CombatSide,
  InspectorSide,
  InteractionSide,
  PlacementHeightControl,
  TerrainSide,
  type PickableIds,
} from './ModeSides';
import { DialogueGraph } from './DialogueGraph';
import { PartyPanel } from './PartyPanel';
import { AbilityPanel } from './AbilityPanel';
import { ItemPanel } from './ItemPanel';
import { CodePanel } from './CodePanel';
import { QuestsWorkspace } from './QuestsWorkspace';
import { ModelsWorkspace } from './ModelsWorkspace';
import { memory, restoreInto } from '../model-memory';
import { ProblemsPopover } from './ProblemsPopover';

/** What the shell needs from `main.ts`: the document, the SRD content it offers, and what a click on the bar should do. */
export interface EditorShellProps {
  onNavigateBuilding?: (x: number, y: number) => void;
  session: EditorSession;
  controller: EditorController;
  terrainIds: readonly string[];
  /** Swatch colour per terrain id, for the Ground tab. */
  terrainColors: Readonly<Record<string, string>>;
  propModels: readonly string[];
  /** The SRD's stat blocks, for the creature library. */
  adversaries: readonly AdversaryDef[];
  /** Ids the validator should consider resolvable. */
  knownModels: ReadonlySet<string>;
  knownAdversaries: ReadonlySet<string>;
  /** The cards the engine ships, listed beside the project's own. */
  libraryAbilities: readonly AbilityDef[];
  /** The vendored SRD content the Party panel picks from, and validates against. */
  characterContent: ContentPack;
  /** The same pack before the project is laid over it: which of the project's cards copy one of its own. */
  characterPack: ContentPack;
  /** The Cards panel's preview: a card as the game draws it. */
  preview?: (card: CardDef) => preact.JSX.Element | null;
  /** A picture of a strip item's model -- a prop, a creature as the board draws it -- or null. */
  thumbnail?: (item: LibraryItem) => { url: string; standIn: boolean } | null;
  /** The scene the party is standing in, which need not be the one being edited. */
  playingScene: string;
  onPlay: () => void;
  /** Play in the room being edited, arriving on its spawns. */
  onPlayHere?: () => void;
  /** Undo and redo, redrawing the board: a session undo alone leaves it stale. */
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  /** Pack files picked under Project, to be laid into the project. */
  onImportPack: (files: readonly File[]) => void;
  /** Project > Export pack: the project's content as a pack file. */
  onExportPack: () => void;
  /** The project's model list changed; the loader should follow. */
  onAssetsChanged?: () => void;
  /**
   * The clip names inside a loaded model file, so the Models panel can offer
   * what the file actually contains rather than asking for names to be typed.
   * Empty until the file has arrived.
   */
  assetClips?: (id: string) => readonly string[];
  /** How an imported model is getting on: unknown, loading, ready or failed. */
  assetStatus?: (id: string) => string;
  /** Start loading every declared model, so their clips can be listed. */
  onRequestAssets?: () => void;
  /**
   * One model's settings changed — its scale, seating, facing or clips. Lighter
   * than `onAssetsChanged`: the file stays loaded, so the panel editing it does
   * not blank its own clip lists between changes.
   */
  onAssetTuned?: (id: string) => void;
  onSwitchScene: (id: string) => void;
  onAddScene: (name: string) => void;
  onRenameScene: (id: string, name: string) => void;
  onRemoveScene: (id: string) => void;
  onSetStartScene: (id: string) => void;
}

/** Typing into a field must not switch modes or close what is being typed in. */
function typing(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function EditorShell(props: EditorShellProps): preact.JSX.Element {
  const { session, controller } = props;
  // The session and controller are mutable objects rather than signals, so the
  // shell re-renders on a version counter, as the side panel did.
  const [version, setVersion] = useState(0);
  // Layout, not passive: an edit made right after mount - the driver's `editAt`
  // right after `setMode('edit')`, or a user's first click after Ctrl+E - must
  // bump this before a passive effect would get its turn, or the shell renders
  // once against state already gone stale.
  useLayoutEffect(() => session.subscribe(() => setVersion((v) => v + 1)), [session]);
  const bump = (): void => setVersion((v) => v + 1);

  // Models imported in this browser come back with it. The file itself rides
  // inside the project document, but the document is not kept between sessions,
  // so an import would go with the tab that made it. A project that declares one
  // of its own keeps it: what is remembered is laid *under* the document.
  useEffect(() => {
    void memory()
      .all()
      .then((kept) => {
        if (restoreInto(session, kept) === 0) return;
        props.onAssetsChanged?.();
        props.onRequestAssets?.();
        bump();
      });
  }, [session]);

  const [menu, setMenu] = useState<Menu | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  /** The conversation whose graph is open, in Interaction. */
  const [graph, setGraph] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [showProblems, setShowProblems] = useState(false);

  const scene = controller.scene;
  const mode = controller.mode;
  const tool = controller.state.tool;

  const changeMode = (next: EditorMode): void => {
    controller.setMode(next);
    setMenu(null);
    setWorkspace(null);
    setGraph(null);
    bump();
  };

  /** Esc closes the nearest thing: a menu, the problems, a workspace, a graph, then the selection. */
  const escape = (): void => {
    if (menu !== null) setMenu(null);
    else if (showProblems) setShowProblems(false);
    else if (workspace !== null) setWorkspace(null);
    else if (graph !== null) setGraph(null);
    else if (controller.selected !== null) {
      controller.selected = null;
      bump();
    }
  };

  // One key listener for the life of the shell, reading the latest handlers.
  // Layout, not passive: a user's first 1-4 right after Ctrl+E must not be
  // dropped while a passive effect is still waiting its turn after paint.
  const keys = useRef({ changeMode, escape });
  keys.current = { changeMode, escape };
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      const index = ['1', '2', '3', '4'].indexOf(event.key);
      if (index >= 0) keys.current.changeMode(EDITOR_MODES[index]!);
      else if (event.key === 'Escape') keys.current.escape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A click anywhere outside a menu closes it, the way every menu bar behaves.
  useEffect(() => {
    if (menu === null) return;
    const onDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest('.ph-menu-wrap') !== null) return;
      setMenu(null);
      // The board sits under the bar, so the same press that closes the menu
      // would otherwise also reach the canvas and paint or select. Other shell
      // controls are unaffected: their own `click` handlers are separate events.
      if (event.target.closest('#gl') !== null) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  const check = (): void => {
    setProblems(
      validateProject(session.project, {
        knownModels: props.knownModels,
        knownAdversaries: props.knownAdversaries,
        knownConditions: new Set([...STARTER_CONDITIONS, ...SRD_CONDITIONS].map((c) => c.id)),
        characterContent: props.characterContent,
      }),
    );
    setShowProblems(true);
  };

  const ids: PickableIds = {
    sceneIds: session.project.scenes.map((s) => s.id),
    dialogueIds: session.project.dialogues.map((d) => d.id),
    encounterIds: scene.encounters.map((e) => e.id),
    quests: session.project.quests,
  };
  // A card's or an item's `run` names the project's code, which is exactly what the runner looks in:
  // the engine ships none of its own.
  const hookIds = session.project.code.map((c) => c.id);
  const closeWorkspace = (): void => setWorkspace(null);
  const useTool = (next: EditorTool): void => {
    controller.setTool(next);
    bump();
  };

  /** A pick from Terrain's strip puts the matching tool in hand. */
  const pickForTerrain = (item: LibraryItem): void => {
    if (item.tab === 'tiles') {
      controller.setTool('buildTile');
      // The strip's id is a label, not a promise: an unknown one leaves the
      // shape alone rather than reaching `buildingTileSchema.parse` and throwing.
      const shape = BUILD_SHAPES.find((candidate) => `tile-${candidate}` === item.id);
      if (shape !== undefined) controller.set('buildShape', shape);
    } else if (item.tab === 'ground') {
      controller.setTool('paintTerrain');
      controller.set('terrainId', item.id);
    } else if (item.tab === 'props') {
      controller.setTool('prop');
      controller.set('propModel', item.id);
    } else {
      controller.setTool('interactable');
      controller.set('interactableKind', item.id as Interactable['kind']);
    }
    bump();
  };
  const pickCreature = (item: LibraryItem): void => {
    controller.setTool('adversary');
    controller.set('adversaryId', item.id);
    bump();
  };
  const terrainPicked =
    tool === 'buildTile' ? `tile-${controller.state.buildShape}` : tool === 'prop'
      ? controller.state.propModel
      : tool === 'interactable'
        ? controller.state.interactableKind
        : tool === 'paintTerrain'
          ? controller.state.terrainId
          : '';

  const openGraph = graph === null ? null : (session.project.dialogues.find((d) => d.id === graph) ?? null);
  // Undo, redo or a Load can drop the conversation whose graph was open (the
  // side panel used `openGraph` and fell back to itself; this state did not).
  // Clearing the stale id here, rather than only in the `body` check below,
  // means a later "+ Conversation" cannot mistake the leftover id for its own.
  useEffect(() => {
    if (graph !== null && openGraph === null) setGraph(null);
  }, [graph, openGraph]);

  let body: preact.JSX.Element | preact.JSX.Element[] | null = null;
  if (workspace === null && openGraph === null) {
    if (mode === 'inspect') {
      body = <InspectorSide session={session} controller={controller} ids={ids} onChange={bump} />;
    } else if (mode === 'terrain') {
      body = [
        <ToolRail key="rail" mode={mode} tools={TERRAIN_RAIL[controller.terrainTab]} current={tool} onTool={useTool} />,
        <PlacementHeightControl key="height" controller={controller} kind="terrain" onChange={bump} />,
        <LibraryStrip
          key="terrain-library"
          testId="terrain-library"
          activeTab={controller.terrainTab}
          onTab={(tab) => {
            if (isTerrainTab(tab)) controller.openTerrainTab(tab);
            bump();
          }}
          tabs={[
            buildingTab(),
            groundTab(props.terrainIds, props.terrainColors),
            propsTab(props.propModels, session.project.assets.map((a) => a.id)),
            objectsTab(),
          ]}
          picked={terrainPicked}
          onPick={pickForTerrain}
          thumbnail={props.thumbnail}
        />,
        <TerrainSide key="side" controller={controller} onChange={bump} onNavigate={props.onNavigateBuilding} />,
      ];
    } else if (mode === 'combat') {
      body = [
        <ToolRail key="rail" mode={mode} tools={MODE_TOOLS.combat} current={tool} onTool={useTool} />,
        <PlacementHeightControl key="height" controller={controller} kind="creature" onChange={bump} />,
        <LibraryStrip
          key="combat-library"
          testId="combat-library"
          tabs={creatureTabs(props.adversaries)}
          onTab={(tab) => {
            const entries = creatureTabs(props.adversaries).find((t) => t.id === tab)?.items ?? [];
            if (!entries.some((item) => item.id === controller.state.adversaryId) && entries[0]) pickCreature(entries[0]);
            else { controller.setTool('adversary'); bump(); }
          }}
          picked={tool === 'adversary' ? controller.state.adversaryId : ''}
          onPick={pickCreature}
          thumbnail={props.thumbnail}
        />,
        <CombatSide key="side" session={session} controller={controller} onChange={bump} />,
      ];
    } else {
      body = <InteractionSide session={session} onOpen={setGraph} onChange={bump} />;
    }
  }

  let workspaceBody: preact.JSX.Element | null = null;
  switch (workspace) {
    case 'party':
      workspaceBody = <PartyPanel session={session} content={props.characterContent} onChange={bump} onClose={closeWorkspace} />;
      break;
    case 'cards':
      workspaceBody = (
        <AbilityPanel
          session={session}
          libraryAbilities={props.libraryAbilities}
          hookIds={hookIds}
          adversaryIds={props.adversaries.map((a) => a.id)}
          content={props.characterContent}
          pack={props.characterPack}
          preview={props.preview}
          {...ids}
          onChange={bump}
          onClose={closeWorkspace}
        />
      );
      break;
    case 'items':
      workspaceBody = (
        <ItemPanel session={session} content={props.characterContent} hookIds={hookIds} {...ids} onChange={bump} onClose={closeWorkspace} />
      );
      break;
    case 'code':
      workspaceBody = <CodePanel session={session} onChange={bump} onClose={closeWorkspace} />;
      break;
    case 'quests':
      workspaceBody = <QuestsWorkspace session={session} onChange={bump} onClose={closeWorkspace} />;
      break;
    case 'models':
      workspaceBody = (
        <ModelsWorkspace
          session={session}
          onAssetsChanged={props.onAssetsChanged}
          assetClips={props.assetClips}
          assetStatus={props.assetStatus}
          onRequestAssets={props.onRequestAssets}
          onAssetTuned={props.onAssetTuned}
          onChange={bump}
          onClose={closeWorkspace}
        />
      );
      break;
    case null:
      break;
  }

  return (
    <div class="ph-editor" data-testid="editor-shell" data-version={version}>
      <TopBar
        session={session}
        mode={mode}
        menu={menu}
        sceneName={scene.name || scene.id}
        sceneSize={`${scene.width}×${scene.height}`}
        problems={problems}
        sceneMenu={
          <SceneMenu
            session={session}
            editing={scene.id}
            playingScene={props.playingScene}
            onSwitch={props.onSwitchScene}
            onAdd={props.onAddScene}
            onRename={props.onRenameScene}
            onRemove={props.onRemoveScene}
            onSetStart={props.onSetStartScene}
            onClose={() => setMenu(null)}
          />
        }
        onMode={changeMode}
        onMenu={setMenu}
        onWorkspace={(next) => {
          setGraph(null);
          setWorkspace(next);
        }}
        onSave={props.onSave}
        onLoad={props.onLoad}
        onImportPack={props.onImportPack}
        onExportPack={props.onExportPack}
        onCheck={check}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        onPlay={props.onPlay}
        onPlayHere={props.onPlayHere}
      />
      {body}
      {openGraph !== null ? (
        <div class="ph-workspace">
          <DialogueGraph session={session} dialogue={openGraph} {...ids} onClose={() => setGraph(null)} onChange={bump} />
        </div>
      ) : null}
      {workspaceBody === null ? null : <div class="ph-workspace">{workspaceBody}</div>}
      {showProblems && problems !== null ? (
        <ProblemsPopover problems={problems} onClose={() => setShowProblems(false)} />
      ) : null}
    </div>
  );
}
