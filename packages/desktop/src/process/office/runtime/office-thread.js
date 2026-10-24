/* SPDX-License-Identifier: MIT
 * UNO integration derived from allotropia/zetajs web-office example.
 * Copyright (c) 2024 allotropia software GmbH and contributors.
 */
'use strict';
let office, css, model, listener;
function configureManagedDocument(context) {
  const provider = context
    .getServiceManager()
    .createInstanceWithContext('com.sun.star.configuration.ConfigurationProvider', context);
  const configuration = provider.createInstanceWithArguments('com.sun.star.configuration.ConfigurationUpdateAccess', [
    new css.beans.PropertyValue({ Name: 'nodepath', Value: '/org.openoffice.Office.Commands/Execute/Disabled' }),
  ]);
  // Use the engine's command policy, avoiding synchronous JavaScript dispatch
  // callbacks into the WASM UI thread. Values omit the .uno: protocol prefix.
  for (const command of [
    'Open',
    'OpenFromWriter',
    'OpenFromCalc',
    'OpenFromImpress',
    'OpenFromDraw',
    'OpenRemote',
    'NewDoc',
    'SaveAs',
    'SaveAsRemote',
    'SaveACopy',
    'SaveAsTemplate',
    'CloseDoc',
    'CloseWin',
    'Quit',
    'Reload',
  ]) {
    const name = `OneWork_${command}`;
    if (configuration.hasByName(name)) continue;
    const entry = configuration.createInstance();
    entry.setPropertyValue('Command', command);
    configuration.insertByName(name, entry);
  }
  configuration.commitChanges();
}
function configureUiLocale(context) {
  const provider = context
    .getServiceManager()
    .createInstanceWithContext('com.sun.star.configuration.ConfigurationProvider', context);
  const l10n = provider.createInstanceWithArguments('com.sun.star.configuration.ConfigurationUpdateAccess', [
    new css.beans.PropertyValue({ Name: 'nodepath', Value: '/org.openoffice.Setup/L10N' }),
  ]);
  // zh-CN when the engine embeds the localization, else this is a no-op and
  // the UI stays en-US; verify by reading the menu bar after a fresh boot.
  l10n.setPropertyValue('ooLocale', 'zh-CN');
  l10n.commitChanges();
}
function removeExternalFileControls(context) {
  const supplier = context.getValueByName('/singletons/com.sun.star.ui.theModuleUIConfigurationManagerSupplier');
  const module = [
    'com.sun.star.text.TextDocument',
    'com.sun.star.sheet.SpreadsheetDocument',
    'com.sun.star.presentation.PresentationDocument',
  ].find((name) => model.supportsService(name));
  if (!module) throw new Error('Unsupported embedded Office document');
  const manager = supplier.getUIConfigurationManager(module);
  const documentManager = model.getUIConfigurationManager();
  const forbidden = new Set([
    '.uno:Open',
    '.uno:OpenFromWriter',
    '.uno:OpenFromCalc',
    '.uno:OpenFromImpress',
    '.uno:OpenFromDraw',
    '.uno:TemplateMenu',
    '.uno:AutoPilotMenu',
    '.uno:OpenRemote',
    '.uno:AddDirect',
    '.uno:NewDoc',
    '.uno:RecentFileList',
    '.uno:SaveAs',
    '.uno:SaveACopy',
    '.uno:CloseDoc',
    '.uno:Quit',
    '.uno:Reload',
  ]);
  const filter = (settings) => {
    for (let index = settings.getCount() - 1; index >= 0; index--) {
      const item = settings.getByIndex(index);
      const command = item.find((property) => property.Name === 'CommandURL')?.Value;
      if (forbidden.has(command)) {
        settings.removeByIndex(index);
        continue;
      }
      const children = item.find((property) => property.Name === 'ItemDescriptorContainer')?.Value;
      if (children) filter(children);
    }
  };
  for (const resource of ['private:resource/menubar/menubar', 'private:resource/toolbar/standardbar']) {
    if (!manager.hasSettings(resource)) continue;
    const settings = manager.getSettings(resource, true);
    filter(settings);
    if (documentManager.hasSettings(resource)) documentManager.replaceSettings(resource, settings);
    else documentManager.insertSettings(resource, settings);
  }
}
Module.zetajs.then((api) => {
  office = api;
  css = office.uno.com.sun.star;
  const desktop = css.frame.Desktop.create(office.getUnoComponentContext());
  office.mainPort.onmessage = (event) => {
    const data = event.data;
    try {
      if (data.cmd === 'load') {
        configureManagedDocument(office.getUnoComponentContext());
        configureUiLocale(office.getUnoComponentContext());
        const descriptors = [new css.beans.PropertyValue({ Name: 'MacroExecutionMode', Value: 0 })];
        if (data.readOnly === true) {
          // Viewer mode for the unified open path; .uno:EditDoc unlocks.
          descriptors.push(new css.beans.PropertyValue({ Name: 'ReadOnly', Value: true }));
        }
        model = desktop.loadComponentFromURL(`file:///tmp/office/${data.fileName}`, '_default', 0, descriptors);
        removeExternalFileControls(office.getUnoComponentContext());
        // The sidebar takes a third of a preview pane, and Impress opens it on the Navigator deck in read-only
        // mode, shrinking the slide to a thumbnail. The slot's own boolean argument sets the state rather than
        // toggling it, so repeating it is safe; repeat once more after the frame has finished building.
        const hideSidebar = () => {
          try {
            css.frame.DispatchHelper.create(office.getUnoComponentContext()).executeDispatch(
              model.getCurrentController().getFrame(),
              '.uno:Sidebar',
              '',
              0,
              [new css.beans.PropertyValue({ Name: 'Sidebar', Value: false })]
            );
          } catch (sidebarError) {
            console.warn('[office] sidebar', String(sidebarError).slice(0, 120));
          }
        };
        hideSidebar();
        setTimeout(hideSidebar, 1000);
        model.getCurrentController().getFrame().getContainerWindow().FullScreen = true;
        // The engine ships English chrome only; the host renders a localized
        // quick toolbar. Hide the built-in menu bar, icon toolbar and status
        // bar deterministically via the frame's layout manager (a
        // .uno:Menubar dispatch would only TOGGLE, and the state persists
        // across boots). The shell builds progressively, so hide right after
        // load and once more after the ready signal. Best effort — keep
        // booting when the kit ignores it.
        const hideEngineChrome = () => {
          try {
            const frame = model.getCurrentController().getFrame();
            const layout = frame.getLayoutManager ? frame.getLayoutManager() : frame.LayoutManager;
            if (!layout) throw new Error('frame exposes no layout manager');
            layout.hideElement('private:resource/menubar/menubar');
            layout.hideElement('private:resource/toolbar/standardbar');
            layout.hideElement('private:resource/statusbar/statusbar');
          } catch (chromeError) {
            office.mainPort.postMessage({ cmd: 'error', message: `chrome: ${String(chromeError).slice(0, 120)}` });
          }
        };
        hideEngineChrome();
        listener = office.unoObject([css.util.XModifyListener], {
          disposing() {},
          modified() {
            if (model.isModified()) office.mainPort.postMessage({ cmd: 'dirty' });
          },
        });
        model.addModifyListener(listener);
        office.mainPort.postMessage({ cmd: 'ready' });
      } else if (data.cmd === 'unlock') {
        // .uno:EditDoc unlocks in place but may swap the internal model,
        // silently detaching the modify listener — re-acquire the live model
        // and re-attach so the save bridge keeps working. Closing and
        // reloading here tears down the WASM kit, so never do that.
        try {
          model.removeModifyListener(listener);
        } catch (error) {
          office.mainPort.postMessage({ cmd: 'error', message: String(error) });
        }
        const current = desktop.getCurrentComponent();
        if (current) model = current;
        listener = office.unoObject([css.util.XModifyListener], {
          disposing() {},
          modified() {
            if (model.isModified()) office.mainPort.postMessage({ cmd: 'dirty' });
          },
        });
        model.addModifyListener(listener);
        office.mainPort.postMessage({ cmd: 'ready' });
        setTimeout(hideEngineChrome, 800);
      } else if (data.cmd === 'dispatch') {
        const helper = css.frame.DispatchHelper.create(office.getUnoComponentContext());
        helper.executeDispatch(model.getCurrentController().getFrame(), `.uno:${data.command}`, '', 0, []);
      } else if (data.cmd === 'store') {
        const unchanged = !model.isModified();
        if (!unchanged) model.store();
        office.mainPort.postMessage({ cmd: 'stored', id: data.id, unchanged });
      }
    } catch (error) {
      let message = String(error);
      try {
        const exception = office.catchUnoException(error);
        if (exception?.Message) message = exception.Message;
      } catch {}
      office.mainPort.postMessage({ cmd: 'error', id: data.id, message });
    }
  };
  office.mainPort.postMessage({ cmd: 'running' });
});
