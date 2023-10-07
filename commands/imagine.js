const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const fs = require('fs');

const url = process.env.URL;
let running = false;

let ADVANCED_CHECKBOX = "#component-14 > label > input";
let QUALITY_RADIOBOX = "[data-testid='Quality-radio-label']";
let IMAGE_AMOUNT = "[data-testid='number-input']";
let SEED_BOX = "#component-38 > label > input"
let SEED_INPUT = "#component-39 > label > input"
let NEGATIVE_INPUT = "#component-37 > label > textarea"

async function run (withPrompt, styleId = 1, quality = false, seedCustom = -1, negative = null) {
	if (running) {
		return "Error: Already running"
	}
	if (styleId == null) {
		styleId = 1
	}

	if (seedCustom == null) {
		seedCustom = -1
	}

	running = true;

    const browser = await puppeteer.launch({});
	const page = await browser.newPage();
	await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url);
	await page.waitForSelector("[data-testid='textbox']");
	await page.type("[data-testid='textbox']", withPrompt);
	
	//open advanced tab by checking the checkbox
	await page.waitForSelector(ADVANCED_CHECKBOX);
	await page.click(ADVANCED_CHECKBOX);

	//input the number of image to genearte
	// await page.waitForSelector("#component-17 > div.wrap.svelte-1cl284s > div > input"); 
	// await page.type("#component-17 > div.wrap.svelte-1cl284s > div > input", "1");
	//set to quality
	if (quality) {
		await page.waitForSelector(QUALITY_RADIOBOX)
		await page.$eval(QUALITY_RADIOBOX, (e) => {
			e.click()
		})
	}
	console.log("styling with id: " + styleId)

	// //input the style of image to generate
	try {
		await page.waitForSelector("#component-42 > div.wrap.svelte-1qxcj04 > label:nth-child(" + styleId + ")");
		await page.$eval("#component-42 > div.wrap.svelte-1qxcj04 > label:nth-child(" + styleId + ")", (e) => {
			e.click()
		})
	}
	catch (e) {
		console.log("button not found")
	}

	if (seedCustom != -1) {
		console.log("setting seed to: " + seedCustom)
		await page.waitForSelector(SEED_BOX);
		await page.$eval(SEED_BOX, (e) => {
			e.click()
		})

		await page.waitForSelector(SEED_INPUT);
		// await page.$eval(SEED_INPUT, (e, seedCustom) => {
		// 	// e.click()
		// 	e.value = seedCustom
		// }, seedCustom)
		await page.click(SEED_INPUT, {clickCount: 3})
		await page.type(SEED_INPUT, seedCustom);

	}

	if (negative != null) {
		await page.waitForSelector(NEGATIVE_INPUT);
		
		await page.click(NEGATIVE_INPUT, {clickCount: 3})
		await page.type(NEGATIVE_INPUT, negative);
	}

	//change the amount of images generated
	await page.waitForSelector(IMAGE_AMOUNT)
	await page.click(IMAGE_AMOUNT)
	await page.keyboard.press('Backspace');
	await page.type(IMAGE_AMOUNT, "1");

	//click button to generate, wait for image to generate
	await page.click("#component-10");
	
	//nth child to change to for loop
	await page.waitForSelector("#component-5 > div.grid-wrap.svelte-1a6pxdl > div > button:nth-child(1)", {timeout:0});
	await page.click("#component-5 > div.grid-wrap.svelte-1a6pxdl > div > button:nth-child(1)");
	await page.waitForSelector("#component-5 > div.preview.svelte-1a6pxdl > img");
	
	//grab the src from the img
	const src = await page.evaluate(() => {
		const img = document.querySelector('#component-5 > div.preview.svelte-1a6pxdl > img');
		return img.src;
	});

	let seed = -1
	//get the seed if possible
	try {
		await page.waitForSelector(SEED_BOX);
		await page.$eval(SEED_BOX, (e) => {
			e.click()
		})
		await page.waitForSelector(SEED_INPUT);
		seed = await page.$eval(SEED_INPUT, (e) => {
			return e.value;
		});
	}
	catch (e) {
		console.log("button not found")
	}

	//download the image
	const viewSource = await page.goto(src);
	//as png file
	//use a datetime filename into /output folder
	const filename = `./output/${new Date().getTime()}.png`;
	fs.writeFile(filename, await viewSource.buffer(), () => console.log('finished downloading!'));

    browser.close();
	running = false;

	//remove ./output/ from the filename before returning
	return {
		filename: filename, 
		seed: seed
	}
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('imagine')
		.setDescription('Generates an image based on your text')
		.addStringOption(option => option.setName('prompt').setDescription('Your prompt for the image to generate').setRequired(true))
		.addStringOption(option => option.setName('style').setDescription('The style of image to generate (1 to 105').setRequired(false))
		.addBooleanOption(option => option.setName('quality').setDescription('Set to true to run at Quality instead of Speed').setRequired(false))
		.addStringOption(option => option.setName('seed').setDescription('The seed to use for the image').setRequired(false))
		.addStringOption(option => option.setName('negative').setDescription('Negative prompt for the image').setRequired(false)),
	async execute(interaction) {
        //time the start and end
		let repl = 'Generating for Prompt: `' + interaction.options.getString('prompt') + "`"
		
		if (interaction.options.getString('negative')) {
			repl += ' `(-' + interaction.options.getString('negative') + ")`"
		}

		repl += '\nOptions:'

		if (interaction.options.getString('style')) {
			repl += ' `Style: ' + interaction.options.getString('style') + "`,"
		}

		if (interaction.options.getString('seed')) {
			repl += ' `Seed: ' + interaction.options.getString('seed') + "`,"
		}
		
		if (interaction.options.getBoolean('quality')) {
			repl += ' `High Quality`,'
		}
		
		await interaction.reply(repl);

		const start = new Date().getTime();
		
		const imagejson = await run(interaction.options.getString('prompt'), interaction.options.getString('style'), interaction.options.getBoolean('quality'), interaction.options.getString('seed'), interaction.options.getString('negative'));
		const name = interaction.user.username;

		if (imagejson == "Error: Already running") {
			await interaction.editReply("Please wait for the previous image to finish generating!");
			return
		}
		const image = imagejson.filename;
		const seed = imagejson.seed;
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
        .setTitle(`${interaction.options.getString('prompt')} ${ interaction.options.getString('negative') ? "(-" + interaction.options.getString('negative') + ")": ""}`)
		.setDescription(`Took ${total} seconds, using seed: ${seed}`)
        .setImage(`attachment://${image.substring(9)}`)
        .setFooter({ text: `${name} used /imagine`, iconURL: interaction.user.avatarURL() })
        .setTimestamp()

		await interaction.editReply({ embeds: [embed], files: [attachment] });
	},
};