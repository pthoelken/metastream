import React, { PureComponent } from 'react'
import { connect } from 'react-redux'
import cx from 'classnames'
import styles from './VideoPlayer.css'
import { PlaybackState, IMediaPlayerState } from 'lobby/reducers/mediaPlayer'
import { updateMedia, updatePlaybackTimer } from 'lobby/actions/mediaPlayer'
import { clamp } from 'utils/math'
import { MEDIA_REFERRER, MEDIA_SESSION_USER_AGENT } from 'constants/http'
import { assetUrl } from 'utils/appUrl'
import { IAppState } from 'reducers'
import { getPlaybackTime2 } from 'lobby/reducers/mediaPlayer.helpers'
import { isHost } from 'lobby/reducers/users.helpers'
import { isEqual } from 'lodash'
import { IReactReduxProps } from 'types/redux-thunk'
import { Webview } from 'components/Webview'

interface IProps {
  className?: string
  theRef?: (c: _VideoPlayer | null) => void
  onInteractChange?: (interacting: boolean) => void
}

interface IConnectedProps extends IMediaPlayerState {
  mute: boolean
  volume: number
  host: boolean
}

interface IState {
  interacting: boolean
}

const DEFAULT_URL = assetUrl('idlescreen.html')

const mapStateToProps = (state: IAppState): IConnectedProps => {
  return {
    ...state.mediaPlayer,
    mute: state.settings.mute,
    volume: state.settings.volume,
    host: isHost(state)
  }
}

type PrivateProps = IProps & IConnectedProps & IReactReduxProps

class _VideoPlayer extends PureComponent<PrivateProps, IState> {
  private webview: Webview | null = null
  // private webContents!: Electron.WebContents

  state: IState = { interacting: false }

  get isPlaying() {
    return this.props.playback === PlaybackState.Playing
  }

  get isPaused() {
    return this.props.playback === PlaybackState.Paused
  }

  get mediaUrl() {
    const media = this.props.current
    return media ? media.url : DEFAULT_URL
  }

  // HACK: Set http referrer to itself to avoid referral blocking
  get httpReferrer() {
    const media = this.props.current

    if (media && media.state && media.state.referrer) {
      return MEDIA_REFERRER
    }

    const { mediaUrl } = this

    try {
      const url = new URL(mediaUrl)
      return url.origin
    } catch (e) {
      return mediaUrl
    }
  }

  componentDidMount(): void {
    if (this.props.theRef) {
      this.props.theRef(this)
    }
  }

  componentWillUnmount(): void {
    if (this.props.theRef) {
      this.props.theRef(null)
    }

    this.props.dispatch(updatePlaybackTimer())
  }

  componentDidUpdate(prevProps: PrivateProps): void {
    const { current } = this.props
    const { current: prevMedia } = prevProps

    if (current !== prevMedia) {
      if (isEqual(current, prevMedia)) {
        // Ignore: new object, same properties
      } else if (current && prevMedia && current.url === prevMedia.url) {
        // Force restart media if new media is the same URL
        this.onMediaReady()
        return
      } else {
        // Update URL on webview otherwise
        this.reload()
        return
      }
    }

    if (this.props.playback !== prevProps.playback) {
      this.updatePlayback(this.props.playback)
    }

    if (
      (this.isPlaying && this.props.startTime !== prevProps.startTime) ||
      (this.isPaused && this.props.pauseTime !== prevProps.pauseTime)
    ) {
      this.updatePlaybackTime()
    }

    if (this.props.volume !== prevProps.volume || this.props.mute !== prevProps.mute) {
      this.updateVolume()
    }
  }

  private setupWebview = (webview: Webview | null): void => {
    this.webview = webview

    if (this.webview) {
      // this.webview.addEventListener('ipc-message', this.onIpcMessage)
      // const wv = this.webview as any
      // wv.addEventListener('did-attach', (e: any) => {
      //   ;(remote as any).getWebContents(e.tabId, (webContents: Electron.WebContents) => {
      //     this.webContents = webContents
      //     this.reload()
      //     const win = window as any
      //     if (process.env.NODE_ENV === 'development') {
      //       win.WEBCONTENTS = webContents
      //     }
      //   })
      // })
    } else {
      // this.webContents = undefined as any
    }
  }

  private dispatchMedia(type: string, payload: any) {
    // ipcRenderer.send('media-action', { type, payload })
  }

  // private onIpcMessage = (event: Electron.IpcMessageEvent) => {
  //   console.log('Received VideoPlayer IPC message', event, event.args)

  //   switch (event.channel) {
  //     case 'media-ready':
  //       this.onMediaReady(...event.args)
  //       break
  //     case 'media-iframes':
  //       this.requestFullScreenIFrame(event.args[0])
  //       break
  //   }
  // }

  private onMediaReady = (info?: any) => {
    console.debug('onMediaReady', info)

    this.updatePlaybackTime()
    this.updatePlayback(this.props.playback)
    this.updateVolume()

    const media = this.props.current
    if (this.props.host) {
      const prevDuration = media ? media.duration : null
      const nextDuration = info && info.duration && !isNaN(info.duration) ? info.duration : null

      const isLiveMedia = prevDuration === 0
      const noDuration = !prevDuration
      const isLongerDuration = nextDuration && (prevDuration && nextDuration > prevDuration)

      if (nextDuration && !isLiveMedia && (noDuration || isLongerDuration)) {
        this.props.dispatch!(updateMedia(info))
        this.props.dispatch!(updatePlaybackTimer())
      }
    }
  }

  private updatePlaybackTime = () => {
    const { current: media } = this.props

    if (media && media.duration === 0) {
      console.debug('Preventing updating playback since duration indicates livestream')
      return // live stream
    }

    let time = getPlaybackTime2(this.props)

    // if (this.webContents && typeof time === 'number') {
    //   console.log('Sending seek IPC message', time)
    //   this.dispatchMedia('seek', time)
    // }
  }

  private updatePlayback = (state: PlaybackState) => {
    // if (this.webContents) {
    //   this.dispatchMedia('playback', state)
    // }
  }

  private updateVolume = () => {
    // if (!this.webContents) {
    //   return
    // }

    // const { volume, mute } = this.props

    // if (mute !== this.webContents.isAudioMuted()) {
    //   this.webContents.setAudioMuted(mute)
    // }

    const newVolume = this.props.mute ? 0 : this.props.volume
    this.dispatchMedia('volume', this.scaleVolume(newVolume))
  }

  /**
   * Use dB scale to convert linear volume to exponential.
   * https://www.dr-lex.be/info-stuff/volumecontrols.html
   */
  private scaleVolume(volume: number): number {
    return clamp(Math.exp(6.908 * volume) / 1000, 0, 1)
  }

  render(): JSX.Element | null {
    return (
      <div
        className={cx(styles.container, this.props.className)}
        onDoubleClick={this.enterInteractMode}
      >
        {this.renderBrowser()}
        {!this.state.interacting ? (
          <div className={styles.interactTrigger} onDoubleClick={this.enterInteractMode} />
        ) : null}
        {this.state.interacting ? (
          <div className={styles.interactNotice}>Interact ON. Press Esc to cancel.</div>
        ) : null}
      </div>
    )
  }

  private renderBrowser(): JSX.Element {
    return (
      <Webview
        componentRef={this.setupWebview}
        src={DEFAULT_URL}
        className={cx(styles.video, {
          [styles.interactive]: this.state.interacting,
          [styles.playing]: !!this.props.current
        })}
      />
    )
  }

  reload(): void {
    // Sometimes loadURL won't work if media is still playing
    // This happens with mixcloud.com
    // this.updatePlayback(PlaybackState.Paused);
    // if (this.webContents) {
    //   this.webContents.loadURL(this.mediaUrl, {
    //     httpReferrer: this.httpReferrer,
    //     userAgent: MEDIA_SESSION_USER_AGENT
    //   })
    // }
    // ipcRenderer.send('media-cleanup')
  }

  debug(): void {
    // if (this.webContents && !this.webContents.isDevToolsOpened()) {
    //   this.webContents.openDevTools()
    // }
  }

  private enterInteractMode = () => {
    this.setState({ interacting: true }, () => {
      document.addEventListener('keydown', this.onKeyDown, false)
      this.dispatchMedia('interact', true)
      if (this.props.onInteractChange) {
        this.props.onInteractChange(this.state.interacting)
      }
    })
  }

  exitInteractMode() {
    document.removeEventListener('keydown', this.onKeyDown, false)
    this.dispatchMedia('interact', false)
    this.setState({ interacting: false }, () => {
      if (this.props.onInteractChange) {
        this.props.onInteractChange(this.state.interacting)
      }
    })
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'Escape':
        this.exitInteractMode()
        return
    }
  }
}

export type VideoPlayer = _VideoPlayer
export const VideoPlayer = connect(mapStateToProps)(_VideoPlayer as any) as React.ComponentClass<
  IProps
>