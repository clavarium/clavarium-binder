/* THE TEMPLATES: where a new list starts. A template only seeds a list -- its
 * states, its fields, the view it opens in -- and everything is changed
 * afterwards, list by list. Nothing refers back to the template.
 *
 * A state may be a GATE: a record reaches it, or any state after it, only once
 * a person approved it (a ticked box). An agent never ticks: it proposes, and
 * works on what was approved.
 *
 * Names are given in each language a list can be made in; what a list holds
 * is its own data afterwards, in the words it was made with.
 */

export const LANGUAGES = ['en', 'fr'];
export const VIEWS = ['list', 'columns', 'cards', 'matrix'];
export const FIELD_TYPES = ['text', 'number', 'date', 'link', 'photo'];

const T = (en, fr) => ({ en, fr });

/* Each state: [key, names, flags]. Flags: gate, done. */
export const TEMPLATES = {
    batches: {
        name: T('Batches', 'Lots'),
        view: 'list',
        states: [
            ['proposed', T('Proposed', 'Proposé')],
            ['approved', T('Approved', 'Validé'), { gate: true }],
            ['doing', T('Doing', 'En cours')],
            ['yours', T('For you', 'Pour toi')],
            ['done', T('Done', 'Fait'), { done: true }],
        ],
        fields: [],
    },
    development: {
        name: T('Development', 'Développement'),
        view: 'columns',
        states: [
            ['todo', T('To do', 'À faire')],
            ['doing', T('Doing', 'En cours')],
            ['yours', T('For you', 'Pour toi')],
            ['done', T('Done', 'Fait'), { done: true }],
        ],
        fields: [],
    },
    customers: {
        name: T('Customers', 'Clients'),
        view: 'list',
        states: [
            ['lead', T('Lead', 'Prospect')],
            ['active', T('Active', 'Actif')],
            ['paused', T('Paused', 'En pause')],
            ['former', T('Former', 'Ancien'), { done: true }],
        ],
        fields: [['phone', T('Phone', 'Téléphone'), 'text'], ['email', T('Email', 'E-mail'), 'text'], ['site', T('Website', 'Site'), 'link']],
    },
    people: {
        name: T('People', 'Personnes'),
        view: 'cards',
        states: [
            ['open', T('Open', 'Ouvert')],
            ['closed', T('Closed', 'Clos'), { done: true }],
        ],
        fields: [['photo', T('Photo', 'Photo'), 'photo'], ['born', T('Born', 'Naissance'), 'date'], ['place', T('Place', 'Lieu'), 'text']],
    },
    roadmap: {
        name: T('Roadmap', 'Roadmap'),
        view: 'columns',
        states: [
            ['idea', T('Idea', 'Idée')],
            ['planned', T('Planned', 'Prévu')],
            ['doing', T('Doing', 'En cours')],
            ['shipped', T('Shipped', 'Livré'), { done: true }],
        ],
        fields: [['target', T('Target', 'Échéance visée'), 'date']],
    },
    priorities: {
        name: T('Priorities', 'Priorités'),
        view: 'matrix',
        states: [
            ['todo', T('To do', 'À faire')],
            ['doing', T('Doing', 'En cours')],
            ['done', T('Done', 'Fait'), { done: true }],
        ],
        /* The four scores the matrix reads, by these ids: urgency and importance
         * place a card (x, y), effort sizes it, delegability tints it. 0 to 100. */
        fields: [
            ['urgence', T('Urgency', 'Urgence'), 'number'],
            ['importance', T('Importance', 'Importance'), 'number'],
            ['charge', T('Effort', 'Charge'), 'number'],
            ['delegabilite', T('Delegability', 'Délégabilité'), 'number'],
        ],
    },
    simple: {
        name: T('Follow-up', 'Suivi simple'),
        view: 'list',
        states: [
            ['open', T('Open', 'Ouvert')],
            ['done', T('Done', 'Fait'), { done: true }],
        ],
        fields: [],
    },
};

/* What a new list made from `template` holds, in `lang`. */
export function seed(template, lang = 'en') {
    const t = TEMPLATES[template];
    if (!t) throw new Error(`no template ${template} (there are: ${Object.keys(TEMPLATES).join(', ')})`);
    const l = LANGUAGES.includes(lang) ? lang : 'en';
    return {
        template,
        title: t.name[l],
        view: t.view,
        states: t.states.map(([id, name, flags = {}]) => ({ id, name: name[l], ...(flags.gate ? { gate: true } : {}), ...(flags.done ? { done: true } : {}) })),
        fields: t.fields.map(([id, name, type]) => ({ id, name: name[l], type })),
    };
}
