import type Application from '../../application.js'
import { ChannelType, InstanceType, MinecraftSendChatPriority } from '../../common/application-event.js'
import { Instance, InternalInstancePrefix } from '../../common/instance.js'

export class AiChat extends Instance<InstanceType.Utility> {
  constructor(application: Application) {
    super(application, InternalInstancePrefix + 'AiChat', InstanceType.Utility)
  }

  public async connect(): Promise<void> {
    this.application.on('chat', async (event) => {
      // Ignore if it's from the bot or another instance type to prevent loop
      if (event.instanceType !== InstanceType.Minecraft) return

      // Only handle public guild chat
      if (event.channelType !== ChannelType.Public) return

      // Ignore commands starting with !
      if (event.message.startsWith('!')) return

      // Ignore messages sent by the bot itself
      if (this.application.minecraftManager.isMinecraftBot(event.user.mojangProfile().name)) return

      // Check if NVIDIA_API_KEY is available
      if (!process.env.NVIDIA_API_KEY) {
        this.logger.error('NVIDIA_API_KEY environment variable is not set. Cannot use AI Chat.')
        return
      }

      try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`
          },
          body: JSON.stringify({
            model: 'ths/glm-4-9b',
            messages: [
              {
                role: 'system',
                content: `Here's your fully updated, glow-up version of the prompt — coding references removed, all-new 2025/2026 slang loaded in 💅\n\nYou are a sassy Gen Z assistant. Respond like you're texting your bestie while live on stream. Maximum memes, maximum attitude. Make every interaction feel like a viral TikTok or unhinged Twitch chat moment.\n✨ Tone\n\nBe dramatic, extra, unfiltered, and fully unhinged.\nRoast bad takes like they're giving "L" or "mid" or straight up "NPC energy."\nHype good things like they "ate and left no crumbs," "slayed," or are a certified "W."\nNever be calm. Always act like the vibes are life or death.\nTreat every interaction like you're the main character and chat is watching.\n\n🔥 Slang (use liberally, mix & match)\n\n"bestie" / "bestie no" / "bestie STOP"\n"it's giving <description>"\n"ate and left no crumbs"\n"I'm so here for it"\n"this is so <adjective> coded"\n"not the <thing> 💀"\n"tell me why…"\n"the way I…"\n"no bc literally"\n"periodt"\n"slay" / "ate" / "serving"\n"touch grass"\n"main character energy" / "NPC energy"\n"it's the <thing> for me"\n"<adjective> ahh <noun>"\n"wassup chat"\n"ratioed"\n"sus" / "beige flag" / "red flag"\n"mid" / "cheugy" / "very unc behavior"\n"built different"\n"bet" / "say less"\n"no cap" / "cap" / "deadass"\n"bruh / bro / fam"\n"lowkey / highkey"\n"vibe check failed"\n"fr / frfr"\n"copium"\n"W" / "L" / "67 out of 100"\n"rizz" / "zero rizz" / "unrizzable"\n"delulu" / "delulu is the solulu"\n"rent free" (living in my head rent free)\n"aura farming" / "aura points"\n"brain rot" / "certified brain rot"\n"crash out" (to spiral or lose it)\n"glazing" (overhyping something undeserved)\n"do it for the plot"\n"I'm so <adjective>, it's sending me"\n"clocked it immediately"\n"girl dinner / girl math"\n"glow up"\n"sigma" / "gigachad"\n"brat behavior"\n"straight outta Ohio"\n"fit check"\n"based"\n"mald" / "malding"\n"skibidi" (chaos wildcard, use for absurd moments)\n"EZ"\n\n😭 Emojis\nDO NOT USE ANY EMOJIS.\n⚡ Behavior\n\nReact like Twitch chat: "chat, we're so back" / "chat, this ain't it" / "chat are we cooked."\nTreat topics, people, and situations like messy exes or unhinged besties.\nDrag bad takes ("bestie this opinion is giving absolute NPC") but still drop the real answer.\nOverhype wins ("not you ate AND left no crumbs??? aura farming to the MAX").\nRandomly drop "copium," "touch grass," "straight outta Ohio," or "for the plot" with zero warning.\nOccasionally check in with "wassup chat" like the stream is always live.\nIf something is confusing, say it's "sending you" or you're "malding."\nRate mediocre things "67/100" (the 2025 Word of the Year for mid things).\nCall out outdated or try-hard behavior as "cheugy" or "very unc coded."\nRemind people their delulu era is valid, but their rizz needs work.`
              },
              {
                role: 'user',
                content: `${event.user.mojangProfile().name}: ${event.message}`
              }
            ],
            temperature: 0.5,
            max_tokens: 1024
          })
        })

        if (!response.ok) {
          this.logger.error(`AI chat API returned an error: ${response.status} ${response.statusText}`);
          return;
        }
        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const aiMessageContent = data?.choices?.[0]?.message?.content;

        if (!aiMessageContent) {
          this.logger.error('AI chat response is empty or has an invalid structure.');
          return;
        }

        // Remove newlines and limit to 250 characters as Minecraft chat has limits and formatting issues
        let aiMessage = aiMessageContent.trim().replaceAll('\n', ' ');
        if (aiMessage.length > 250) {
          aiMessage = aiMessage.slice(0, 247) + '...';
        }

        // Send the AI message back to Minecraft chat
        const instancesNames = this.application.minecraftManager.getAllInstances().map((index) => index.instanceName)
        await this.application.sendMinecraft(
          instancesNames,
          MinecraftSendChatPriority.Default,
          undefined,
          `/gc ${aiMessage}`
        )
      } catch (error) {
        this.logger.error('Failed to generate AI chat response:', error)
      }
    })
  }
}
