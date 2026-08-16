export const me = {
	name: 'Ee Loong Low',
	title: 'Graphics Programmer & Software Engineer',
	location: 'Singapore',
	phone: '+65 88012145',
	summary: 'I love building products that come to life, whether it is designing a graphics engine for a game or developing an intuitive Android app. Seeing my creations in action fuels my passion for coding and problem solving. Through my Polytechnic Diploma & Bachelor\'s program, I honed my skills in C++, C, Computer Graphics, and Android Development while leading projects in team environments.',
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
		period: 'Oct 2022 - Apr 2026',
		status: 'Current',
		isCurrent: true
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
		company: 'Seagate Technology',
		logo: '/images/seagate.jpg',
		role: 'Software Development Intern',
		period: 'May 2025 - Apr 2026',
		location: 'Singapore',
		current: true,
		achievements: [
			'Developed a C .NET Vertically Integrated Quality System web application for parameter management',
			'Created an accompanying Java backend data exporter for the system which ran on 15 minute schedule',
			'Created and manipulated Oracle SQL tables to work with the Vertically Integrated Quality System'
		],
		technologies: ['C#', '.NET', 'Java', 'Oracle SQL']
	},
	{
		id: 2,
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
		title: 'Valuation Desk',
		role: 'Tool',
		period: '2026',
		institution: 'Personal Project',
		description: 'Interactive discounted cash flow workbench and valuation tool built with vanilla JS and Chart.js.',
		achievements: [
			'Interactive DCF builder with projections, sensitivity, and comps cross-check',
			'Exportable model JSON/CSV and editable projections',
			'Client-side data fetch from Financial Modeling Prep API (optional)'
		],
		technologies: ['JavaScript', 'Chart.js', 'Astro'],
		link: '/projects/valuation',
		featured: false
	}
];

export const skills = {
	languages: ['C++', 'C', 'C#', 'Python', 'Java', 'SQL', 'Kotlin', 'Assembly', 'CUDA', 'LATEX'],
	tools: ['OpenGL', 'Visual Studio 2022', 'Nvidia Nsight', 'Nvidia Compute', 'Android Studio', 'Git', 'GitHub'],
	fundamentals: ['Data Structures', 'Operating System Fundamentals', 'Computer Networks', 'Algorithm Analysis', 'Collision Detection', 'Pathfinding Algorithms'],
	soft: ['Team Leadership', 'Project Planning', 'Communication'],
	spokenLanguages: [
		{ language: 'English', level: 'Native Fluency' },
		{ language: 'Chinese', level: 'Professional Working Fluency' }
	]
};
