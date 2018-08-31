import * as vscode from 'vscode';
import { ExtensionState, startSession } from './extension-state';
import { Session } from './session';

async function getType(
    session: Session,
    sel: vscode.Range,
    doc: vscode.TextDocument):
    Promise<null | [vscode.Range, string]> {

    if (session.loading === null) {
        session.reload();
    }

    await session.loading;

    if (sel.start.isEqual(sel.end)) {
        sel = doc.getWordRangeAtPosition(sel.start);
    }
    const extensedSelectedText = doc.getText(new vscode.Range(
        new vscode.Position(sel.start.line, sel.start.character - 1),
        new vscode.Position(sel.end.line, sel.end.character + 1)
    ));
    if (extensedSelectedText.startsWith(".")) {
        const newStart = doc.getWordRangeAtPosition(new vscode.Position(sel.start.line, sel.start.character - 2)).start;
        sel = new vscode.Range(newStart, sel.end);
    }
    if (extensedSelectedText.endsWith(".")) {
        const newEnd = doc.getWordRangeAtPosition(new vscode.Position(sel.end.line, sel.end.character + 2)).end;
        sel = new vscode.Range(sel.start, newEnd);
    }

    const typeAtCmd = `:type-at ${doc.uri.fsPath} ${sel.start.line + 1} ${sel.start.character + 1} ${sel.end.line + 1} ${sel.end.character + 1}`;
    const typeAtResult = (await session.ghci.sendCommand(typeAtCmd)).filter(s => s.trim().length > 0);
    if(typeAtResult.length == 0) {
        return null;
    }
    if (typeAtResult[0].indexOf("<no location info>") != -1) {
        return null;
    }
    const type = typeAtResult.map(s => s.trim().replace(":: ", "")).join(" ");
    return [sel, type];
}

export function registerRangeType(ext: ExtensionState) {
    const context = ext.context;
    let selTimeout: NodeJS.Timer | null = null;

    const decoCurrent = vscode.window.createTextEditorDecorationType({
        borderStyle: 'solid',
        borderColor: '#66f',
        borderWidth: '0px 0px 1px 0px'
    });

    const decoType = vscode.window.createTextEditorDecorationType({
        after: {
            color: '#999',
            margin: '0px 0px 0px 20px'
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    })

    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((event) => {
        const doc = event.textEditor.document;
        if (doc.languageId !== 'haskell' && ! doc.uri.fsPath.endsWith('.hs'))
            return;
        
        if (doc.isDirty) {
            event.textEditor.setDecorations(decoCurrent, []);
            event.textEditor.setDecorations(decoType, []);
        } else {
            if (selTimeout !== null) {
                clearTimeout(selTimeout);
            }

            const sel = event.selections[0];

            selTimeout = setTimeout(async () => {
                const session = await startSession(ext, doc);
                const res = await getType(session, sel, doc);
                if (res !== null) {
                    const [range, type] = res;
                    const lineRange = doc.lineAt(range.start.line).range;
                    event.textEditor.setDecorations(decoCurrent, [{
                        range,
                        hoverMessage: type
                    }]);
                    event.textEditor.setDecorations(decoType, [{
                        range: lineRange,
                        renderOptions: {
                            after: {
                                contentText: `:: ${type}`
                            }
                        }
                    }]);
                } else {
                    event.textEditor.setDecorations(decoCurrent, []);
                    event.textEditor.setDecorations(decoType, []);
                }
                selTimeout = null;
            }, 300);
        }
    }));
}