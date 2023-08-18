const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');

const url = process.env.URL;
let running = false;
// let browser
// let page

// //make instance check if browser and page already exists
// //if not, create new instance
// //if exists, use existing instance
// async function getInstance() {
// 	if (browser == null || page == null) {
// 		browser = await puppeteer.launch({headless: false});
// 		page = await browser.newPage();
// 		await page.goto(url);
// 	}
// 	return page
// }

async function run (withPrompt, styleId = 1, quality = false) {
	if (running) {
		return "Error: Already running"
	}
	running = true;

    const browser = await puppeteer.launch({headless: false});
	const page = await browser.newPage();
	await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url);
	await page.waitForSelector("[data-testid='textbox']");
	await page.type("[data-testid='textbox']", withPrompt);
	
	//open advanced tab by checking the checkbox
	await page.waitForSelector("#component-12 > label > input");
	await page.click("#component-12 > label > input");

	//input the number of image to genearte
	// await page.waitForSelector("#component-17 > div.wrap.svelte-1cl284s > div > input"); 
	// await page.type("#component-17 > div.wrap.svelte-1cl284s > div > input", "1");
	//set to quality
	if (quality) {
		await page.waitForSelector("#component-15 > div.wrap.svelte-1p9xokt > label:nth-child(2)")
		await page.$eval("#component-15 > div.wrap.svelte-1p9xokt > label:nth-child(2)", (e) => {
			e.click()
		})
	}

	// //input the style of image to generate
	try {
		// await page.waitForSelector("#component-57 > div.tab-nav.scroll-hide.svelte-kqij2n > button:nth-child(2)")
		// await page.$eval("#component-57 > div.tab-nav.scroll-hide.svelte-kqij2n > button:nth-child(2)")

		await page.waitForSelector("#component-23 > div.wrap.svelte-1p9xokt > label:nth-child(" + styleId + ")");
		await page.$eval("#component-23 > div.wrap.svelte-1p9xokt > label:nth-child(" + styleId + ")", (e) => {
			e.click()
		})
	}
	catch (e) {
		console.log("button not found")
	}
	
	//click button to generate, wait for image to generate
	await page.click("#component-10");
	await page.waitForSelector("#component-5 > div.grid-wrap.svelte-1a6pxdl > div > button:nth-child(1)", {timeout:0});
	await page.click("#component-5 > div.grid-wrap.svelte-1a6pxdl > div > button:nth-child(1)");
	await page.waitForSelector("#component-5 > div.preview.svelte-1a6pxdl > img");
	
	//grab the src from the img
	const src = await page.evaluate(() => {
		const img = document.querySelector('#component-5 > div.preview.svelte-1a6pxdl > img');
		return img.src;
	});
	//download the image
	const viewSource = await page.goto(src);
	//as png file
	//use a datetime filename into /output folder
	const filename = `./output/${new Date().getTime()}.png`;
	fs.writeFile(filename, await viewSource.buffer(), () => console.log('finished downloading!'));

    browser.close();
	running = false;

	//remove ./output/ from the filename before returning
	return filename
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('imagine')
		.setDescription('Generates an image based on your text')
		.addStringOption(option => option.setName('prompt').setDescription('Your prompt for the image to generate').setRequired(true))
		.addStringOption(option => option.setName('style').setDescription('The style of image to generate (1 to 105').setRequired(false))
		.addBooleanOption(option => option.setName('quality').setDescription('Set to true to run at Quality instead of Speed').setRequired(false)),
	async execute(interaction) {
        //time the start and end
		let repl = 'Generating for prompt: ' + interaction.options.getString('prompt')
		if (interaction.options.getBoolean('quality')) {
			repl += ' [High Quality]'
		}
		
		await interaction.reply(repl);

		const start = new Date().getTime();
		
		const image = await run(interaction.options.getString('prompt'), interaction.options.getString('style'), interaction.options.getBoolean('quality'));
		const name = interaction.user.username;

		if (image == "Error: Already running") {
			await interaction.editReply("Please wait for the previous image to finish generating!");
			return
		}
			
		//attachment builder
		const attachment = new AttachmentBuilder(image);
		
		//end
		const end = new Date().getTime();

		//total seconds
		const total = (end - start) / 1000;

		let embed = new EmbedBuilder()
        .setColor("Random")
        // .setAuthor({ name: interaction.user.username, iconURL: interaction.user.avatarURL() })
        .setAuthor({ name: name, iconURL: interaction.user.avatarURL() })
        .setTitle(`${interaction.options.getString('prompt')}: ${total} seconds`)
        .setImage(`attachment://${image.substring(9)}`)
        .setFooter({ text: `${name} used /imagine`, iconURL: interaction.user.avatarURL() })
        .setTimestamp()

		await interaction.editReply({ embeds: [embed], files: [attachment] });
	},
};