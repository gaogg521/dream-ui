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
        model = desktop.loadComponentFromURL(`file:///tmp/office/${data.fileName}`, '_default', 0, [
          new css.beans.PropertyValue({ Name: 'MacroExecutionMode', Value: 0 }),
        ]);
        removeExternalFileControls(office.getUnoComponentContext());
        model.getCurrentController().getFrame().getContainerWindow().FullScreen = true;
        listener = office.unoObject([css.util.XModifyListener], {
          disposing() {},
          modified() {
            if (model.isModified()) office.mainPort.postMessage({ cmd: 'dirty' });
          },
        });
        model.addModifyListener(listener);
        office.mainPort.postMessage({ cmd: 'ready' });
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
