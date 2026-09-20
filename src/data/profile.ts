export const me = {
	name: 'Ee Loong Low',
	title: 'Graphics Programmer & Software Engineer',
	location: 'Singapore',
	phone: '+65 88012145',
	summary: 'I\'m a Computer Science graduate with hands-on experience building production web applications in C# and ASP.NET Core, and strong fundamentals in backend systems programming with C/C++. I love building products that come to life — whether it is a graphics engine for a game, an embedded gateway service, or a data-heavy internal tool — and I\'m motivated by shipping software that works reliably in production.',
	LinkedIn: 'https://www.linkedin.com/in/low-ee-loong/',
	Email: 'mailto:eeloonglow@gmail.com'
};

export type Project = {
	id: number;
	title: string;
	role: string;
	period: string;
	institution: string;
	description: string;
	achievements: string[];
	technologies: string[];
	link: string | null;
	featured: boolean;
};

export const education = [
	{
		id: 1,
		schools: [
			{
				name: 'Singapore Institute of Technology',
				logo: '/images/SITlogo.svg'
			},
			{
				name: 'DigiPen Institute of Technology',
				logo: '/images/DigiPen_RGB_Red.png'
			}

		],
		degree: 'Bachelor of Science in Computer Science in Real-Time Interactive Simulation',
		period: 'Oct 2022 - May 2026',
		status: 'Completed',
		isCurrent: false
	},
	{
		id: 2,
		schools: [
			{
				name: 'Ngee Ann Polytechnic',
				logo: '/images/NPlogo.png'
			}
		],
		degree: 'Polytechnic Diploma in Electronic & Computer Engineering',
		period: 'Apr 2017 - May 2020',
		status: 'Completed',
		isCurrent: false
	}
];

export const workExperience = [
	{
		id: 1,
		company: 'Aztech Technologies',
		logo: '/images/aztech.png',
		role: 'R&D Software Engineer',
		period: 'Jun 2026 - Present',
		location: 'Singapore',
		current: true,
		achievements: [
			'Extended a C++ Linux daemon bus service with new inter-process communication features between Wi-SUN mesh smart lighting node devices and the Linux gateway they connect to',
			'Built an OTA firmware transfer pipeline alongside the signal-handling and logging layer for the embedded gateway service, allowing smart lighting nodes to be updated wirelessly'
		],
		technologies: ['C++', 'Linux', 'IPC', 'Wi-SUN', 'Embedded Systems']
	},
	{
		id: 2,
		company: 'Seagate Technology',
		logo: '/images/seagate.jpg',
		role: 'Software Development Intern',
		period: 'May 2025 - Apr 2026',
		location: 'Singapore',
		current: false,
		achievements: [
			'Modernised a legacy VB.NET WebForms application to ASP.NET Core 8.0 MVC, implementing LDAP authentication and role-based access control across three permission tiers',
			'Designed and built a Java backend data exporter integrating Oracle SQL with Hadoop, eliminating ~320 duplicate records per week through SQL MERGE operations and window function deduplication',
			'Built an interactive data management UI using ASP.NET Core MVC, DataTables, and Select2',
			'Developed and maintained the Oracle SQL schema, including table design, stored procedures, and a staging-table ETL pipeline feeding downstream Tableau dashboards'
		],
		technologies: ['C#', 'ASP.NET Core', 'VB.NET', 'Java', 'Oracle SQL', 'Hadoop', 'Tableau']
	},
	{
		id: 3,
		company: 'ST Engineering',
		logo: '/images/STEngineering.png',
		role: 'Product Test Intern / Assistant Engineer',
		period: 'Sep 2019 - May 2020',
		location: 'Singapore',
		current: false,
		achievements: [
			'Developed automated test scripts for the ST Electronics SuperneT2 Air Traffic Control communication system, enhancing efficiency by 15%',
			'Facilitated the deployment of new releases of the SuperneT2 Air Traffic Control communication system to in-house customer machines, enhancing system performance and user efficiency',
			'Coached and guided incoming interns, ensuring a smooth transition of roles and responsibilities'
		],
		technologies: []
	}
];

export const projects: Project[] = [
	{
		id: 1,
		title: 'Exodus II',
		role: 'Graphics Programmer',
		period: 'Sep 2024 - Apr 2025',
		institution: 'DigiPen Institute of Technology',
		description: 'Co-developed Exodus II, a retro, first-person shooter developed on our own custom developed 3D game engine',
		achievements: [
			'Led a team of 5 to develop a fully featured rendering engine with OpenGL for the game engine',
			'Created the rendering pipeline to transform assets such as .fbx files to tailor made resources adapted for 3d rendering on screen',
			'Assigned and integrated visual effects such as screen space filters and HDR rendering into the rendering pipeline'
		],
		technologies: ['OpenGL', 'C++', 'Custom 3D Game Engine'],
		link: 'https://arcade.digipen.edu/games/exodus2',
		featured: true
	},
	{
		id: 2,
		title: 'Exodus',
		role: 'Project Manager, Graphics Programmer',
		period: 'Sep 2023 - Apr 2024',
		institution: 'DigiPen Institute of Technology',
		description: 'Co-developed Exodus, a top-down shooter developed on our own custom developed 2D game engine',
		achievements: [
			'Designed and optimized the OpenGL-based rendering pipeline, reducing frame times by 30%',
			'Implemented in-game lighting and graphical effects using C++ (engine) and C# (scripting)',
			'Led a team of 6 developers & 2 designers, ensuring on-time milestone delivery'
		],
		technologies: ['OpenGL', 'C++', 'C#', 'Custom 2D Game Engine'],
		link: 'https://arcade.digipen.edu/games/exodus',
		featured: true
	},
	{
		id: 3,
		title: 'The Deliverables',
		role: 'Game Developer',
		period: 'Aug 2022 - Dec 2022',
		institution: 'DigiPen Institute of Technology',
		description: 'Co-developed The Deliverables, a top-down shooter game embodying the unforgiving nature of schools projects',
		achievements: [
			'Designed and implemented 5 unique weapons for enemies, enhancing gameplay diversity and user engagement by 15% based on player feedback',
			'All code was written in the C programming language',
			'Implemented 5 unique weapons while ensuring balanced gameplay based on playtesting data, resulting in a 15% increase in user engagement'
		],
		technologies: ['C'],
		link: null,
		featured: false
	},
	{
		id: 4,
		title: 'Personal Portfolio Website',
		role: 'Developer',
		period: 'Mar 2024 - Apr 2024',
		institution: 'Personal Project',
		description: 'Designed and developed this personal portfolio website to showcase my projects and experience',
		achievements: [
			'Built with Astro and Tailwind CSS, ensuring a responsive and visually appealing design',
			'Implemented a custom dark mode toggle, enhancing user experience and accessibility',
			'Optimized for performance and SEO, resulting in a 20% increase in page load speed'
		],
		technologies: ['Astro', 'Tailwind CSS', 'JavaScript'],
		link: 'https://eeloonglow.com',
		featured: false
	},
	{
		id: 5,
		title: 'CarousellScraper',
		role: 'Creator',
		period: 'March 2026 - Present',
		institution: 'Personal Project',
		description: 'Built an end-to-end market monitoring platform for Carousell Singapore PC listings, combining automated data collection, LLM-assisted valuation, and a Cloudflare-hosted dashboard for actionable deal insights.',
		achievements: [
			'Designed a browserless data collection pipeline in Python with configurable query, sorting, and pricing filters to support targeted market tracking',
			'Implemented robust session handling, request retries, and token refresh workflows to improve reliability for scheduled unattended runs',
			'Built deduplication and price-drop re-evaluation logic so previously seen listings are skipped unless price changes materially affect deal score',
			'Designed batched LiteLLM orchestration across Gemini, Groq, and Qwen with graceful fallback and automated recovery from rate-limit or transient provider failures',
			'Computed intrinsic value and deal score from extracted components, then persisted normalized listing plus analysis data into Cloudflare D1',
			'Integrated local Windows Task Scheduler automation with a Cloudflare Pages dashboard (Astro) for continuous monitoring and admin search management'
		],
		technologies: ['Python', 'curl_cffi', 'LiteLLM', 'Cloudflare D1', 'Cloudflare Pages', 'Astro', 'Tailwind CSS', 'Windows Task Scheduler'],
		link: '/projects/carousell-bot',
		featured: true
	}
	,
	{
		id: 6,
		title: 'Stock Research',
		role: 'Tool',
		period: '2026',
		institution: 'Personal Project',
		description: 'On-demand stock research: live PE/P/S/PEG from Yahoo Finance, SEC segment revenue breakdown, LLM-assisted earnings audit of one-off items, peer comparison, and a fair-value band.',
		achievements: [
			'Live PE/P/S/PEG for any ticker, including SGX (.SI), fetched on demand with no stored universe',
			'SEC EDGAR segment-revenue breakdown from raw 10-K XBRL, with an HTML-note fallback for companies that only tag the aggregate',
			'LLM-classified earnings audit that adjusts EPS/PE for one-off items — arithmetic done in code, LLM only labels',
			'Peer comparison and fair-value band computed from peer-average P/E × EPS with a disclosed ±20% band'
		],
		technologies: ['Astro', 'Tailwind CSS', 'Cloudflare Workers', 'Cloudflare KV', 'Yahoo Finance', 'SEC EDGAR', 'OpenRouter'],
		link: '/projects/stocks',
		featured: false
	}
];

export const skills = {
	languages: ['C++', 'C', 'C#', 'Python', 'Java', 'SQL', 'Kotlin', 'Assembly', 'CUDA', 'LATEX'],
	tools: ['OpenGL', 'ASP.NET Core', 'Visual Studio 2022', 'Nvidia Nsight', 'Nvidia Compute', 'Android Studio', 'Git', 'GitHub'],
	fundamentals: ['Data Structures', 'Operating System Fundamentals', 'Computer Networks', 'Algorithm Analysis', 'Collision Detection', 'Pathfinding Algorithms'],
	soft: ['Team Leadership', 'Project Planning', 'Communication', 'Agile/Scrum'],
	spokenLanguages: [
		{ language: 'English', level: 'Native Fluency' },
		{ language: 'Chinese', level: 'Professional Working Fluency' }
	]
};
