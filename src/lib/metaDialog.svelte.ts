// The folder metadata dialog, one for the app: any menu or notice can raise it for a folder
class MetaDialogController {
	open = $state(false);
	folderId = $state('');

	show(folderId: string) {
		this.folderId = folderId;
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const metaDialog = new MetaDialogController();
