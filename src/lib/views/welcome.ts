import DocHandle from '#lib/models/DocHandle.js';
import Folder from '#lib/models/Folder.js';
import View from '#lib/models/View.svelte.js';
import type { Source } from '#lib/models/Source.js';
import { applyProjectTemplate } from '#lib/views/project.svelte.js';

const NAME = 'Welcome';

function verse(stanzas: string[][]): string {
	return stanzas.map((lines) => lines.join('  \n')).join('\n\n') + '\n';
}

const POEMS: { title: string; body: string }[] = [
	{
		title: 'Ozymandias',
		body: verse([
			[
				'I met a traveller from an antique land,',
				'Who said: Two vast and trunkless legs of stone',
				'Stand in the desert. Near them, on the sand,',
				'Half sunk, a shattered visage lies, whose frown,',
				'And wrinkled lip, and sneer of cold command,',
				'Tell that its sculptor well those passions read',
				'Which yet survive, stamped on these lifeless things,',
				'The hand that mocked them, and the heart that fed;',
				'And on the pedestal, these words appear:',
				'My name is Ozymandias, King of Kings;',
				'Look on my Works, ye Mighty, and despair!',
				'Nothing beside remains. Round the decay',
				'Of that colossal Wreck, boundless and bare',
				'The lone and level sands stretch far away.'
			],
			['Percy Bysshe Shelley, 1818']
		])
	},
	{
		title: 'Hope is the thing with feathers',
		body: verse([
			[
				'"Hope" is the thing with feathers -',
				'That perches in the soul -',
				'And sings the tune without the words -',
				'And never stops - at all -'
			],
			[
				'And sweetest - in the Gale - is heard -',
				'And sore must be the storm -',
				'That could abash the little Bird',
				'That kept so many warm -'
			],
			[
				"I've heard it in the chillest land -",
				'And on the strangest Sea -',
				'Yet - never - in Extremity,',
				'It asked a crumb - of me.'
			],
			['Emily Dickinson, c. 1861']
		])
	},
	{
		title: 'The Road Not Taken',
		body: verse([
			[
				'Two roads diverged in a yellow wood,',
				'And sorry I could not travel both',
				'And be one traveler, long I stood',
				'And looked down one as far as I could',
				'To where it bent in the undergrowth;'
			],
			[
				'Then took the other, as just as fair,',
				'And having perhaps the better claim,',
				'Because it was grassy and wanted wear;',
				'Though as for that the passing there',
				'Had worn them really about the same,'
			],
			[
				'And both that morning equally lay',
				'In leaves no step had trodden black.',
				'Oh, I kept the first for another day!',
				'Yet knowing how way leads on to way,',
				'I doubted if I should ever come back.'
			],
			[
				'I shall be telling this with a sigh',
				'Somewhere ages and ages hence:',
				'Two roads diverged in a wood, and I,',
				'I took the one less traveled by,',
				'And that has made all the difference.'
			],
			['Robert Frost, 1916']
		])
	}
];

function dayFromNow(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todo(title: string, fields: Record<string, unknown>) {
	return { title, groupIds: ['tag:todo'], properties: { views: { todo: fields } } };
}

export async function seedWelcomeProject(source: Source): Promise<View> {
	const folder = await Folder.create(NAME, source.id);
	const view = await View.forUnit(folder.id, folder.slug);
	view.emoji = '🗿';
	applyProjectTemplate(view, 'project');
	await view.save();

	const notes = [
		...POEMS,
		todo('Write your first note', { due: dayFromNow(0) }),
		todo('Drag a todo across the board', { status: 'doing', due: dayFromNow(1) }),
		todo('Delete the Welcome project', { due: dayFromNow(7) })
	];
	for (const n of notes) {
		await DocHandle.createFromTitle(source, { ...n, dir: NAME });
	}
	return view;
}
